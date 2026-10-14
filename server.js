const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

const ROOT = __dirname;
const MUSIC_DIR = path.join(ROOT, "music");
const DATA_FILE = path.join(MUSIC_DIR, "tracks.json");
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const PORT = Number(process.env.PORT || 8000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ALLOWED_EXTENSIONS = new Set([
  ".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".weba", ".webm",
]);
const CONTENT_TYPES = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".webm": "audio/webm",
};
let catalogWrite = Promise.resolve();

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD ortam değişkeni ayarlanmalı. README.md dosyasındaki çalıştırma adımlarını izleyin.");
  process.exit(1);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function isAdmin(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Basic ")) return false;
  let credentials;
  try {
    credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = credentials.indexOf(":");
  if (separator < 0 || credentials.slice(0, separator) !== "admin") return false;
  const providedPassword = Buffer.from(credentials.slice(separator + 1));
  const expectedPassword = Buffer.from(ADMIN_PASSWORD);
  return providedPassword.length === expectedPassword.length
    && crypto.timingSafeEqual(providedPassword, expectedPassword);
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  sendJson(response, 401, { error: "Yetkisiz." });
  return false;
}

async function readTracks() {
  try {
    const value = JSON.parse(await fsp.readFile(DATA_FILE, "utf8"));
    if (!Array.isArray(value)) throw new Error("Şarkı kataloğu geçersiz.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeTracks(tracks) {
  const tempFile = `${DATA_FILE}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(tempFile, JSON.stringify(tracks, null, 2), { flag: "wx" });
    await fsp.rename(tempFile, DATA_FILE);
  } finally {
    await fsp.unlink(tempFile).catch(() => {});
  }
}

function updateCatalog(update) {
  const operation = catalogWrite.then(async () => {
    const tracks = await readTracks();
    const result = await update(tracks);
    await writeTracks(tracks);
    return result;
  });
  catalogWrite = operation.catch(() => {});
  return operation;
}

function serveStatic(urlPath, response) {
  const files = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  };
  const file = files[urlPath];
  if (!file) {
    sendJson(response, 404, { error: "Bulunamadı." });
    return;
  }
  response.writeHead(200, {
    "Content-Type": file[1],
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(path.join(ROOT, file[0])).pipe(response);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/admin/session" && request.method === "POST") {
    if (requireAdmin(request, response)) sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/tracks" && request.method === "GET") {
    const tracks = await readTracks();
    sendJson(response, 200, tracks.map(({ id, name, duration, addedAt }) => ({ id, name, duration, addedAt })));
    return;
  }

  if (pathname === "/api/tracks" && request.method === "POST") {
    if (!requireAdmin(request, response)) {
      request.resume();
      return;
    }
    const name = url.searchParams.get("name")?.trim();
    const durationValue = Number(url.searchParams.get("duration"));
    const duration = Number.isFinite(durationValue) && durationValue >= 0 ? durationValue : 0;
    if (!name || name.length > 240 || /[\u0000-\u001f\u007f]/.test(name)) {
      request.resume();
      sendJson(response, 400, { error: "Dosya adı geçersiz." });
      return;
    }
    const extension = path.extname(name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      request.resume();
      sendJson(response, 415, { error: "Bu ses dosyası biçimine izin verilmiyor." });
      return;
    }
    const declaredSize = Number(request.headers["content-length"] || 0);
    if (declaredSize > MAX_FILE_SIZE) {
      request.resume();
      sendJson(response, 413, { error: "Dosya boyutu en fazla 100 MB olabilir." });
      return;
    }

    await fsp.mkdir(MUSIC_DIR, { recursive: true });
    const id = crypto.randomUUID();
    const tempPath = path.join(MUSIC_DIR, `${id}.upload`);
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_FILE_SIZE) {
        const error = new Error("Dosya boyutu en fazla 100 MB olabilir.");
        error.code = "UPLOAD_TOO_LARGE";
        request.destroy(error);
      }
    });
    try {
      await pipeline(request, fs.createWriteStream(tempPath, { flags: "wx" }));
      if (size === 0) {
        await fsp.unlink(tempPath);
        sendJson(response, 400, { error: "Boş dosya yüklenemez." });
        return;
      }
      const safeName = path.basename(name);
      const destination = path.join(MUSIC_DIR, `${id}${extension}`);
      await fsp.rename(tempPath, destination);
      try {
        await updateCatalog((tracks) => {
          tracks.push({
            id,
            name: safeName,
            duration,
            addedAt: Date.now(),
            file: path.basename(destination),
            contentType: CONTENT_TYPES[extension],
          });
        });
      } catch (error) {
        await fsp.unlink(destination).catch(() => {});
        throw error;
      }
      sendJson(response, 201, { id, name: safeName });
    } catch (error) {
      await fsp.unlink(tempPath).catch(() => {});
      if (error.code === "UPLOAD_TOO_LARGE") {
        sendJson(response, 413, { error: "Dosya boyutu en fazla 100 MB olabilir." });
      } else {
        throw error;
      }
    }
    return;
  }

  const audioMatch = pathname.match(/^\/api\/tracks\/([0-9a-f-]{36})\/audio$/i);
  if (audioMatch && request.method === "GET") {
    const track = (await readTracks()).find((item) => item.id === audioMatch[1]);
    if (!track) {
      sendJson(response, 404, { error: "Şarkı bulunamadı." });
      return;
    }
    const audioPath = path.join(MUSIC_DIR, track.file);
    const stat = await fsp.stat(audioPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) {
      sendJson(response, 404, { error: "Şarkı dosyası bulunamadı." });
      return;
    }
    const range = request.headers.range;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || (!match[1] && !match[2])) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        response.end();
        return;
      }
      const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      const end = match[2] && match[1] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || end < start) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        response.end();
        return;
      }
      response.writeHead(206, {
        "Content-Type": track.contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      fs.createReadStream(audioPath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, {
      "Content-Type": track.contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(audioPath).pipe(response);
    return;
  }

  const trackMatch = pathname.match(/^\/api\/tracks\/([0-9a-f-]{36})$/i);
  if (trackMatch && request.method === "DELETE") {
    if (!requireAdmin(request, response)) return;
    let track;
    await updateCatalog((tracks) => {
      track = tracks.find((item) => item.id === trackMatch[1]);
      if (track) {
        const index = tracks.indexOf(track);
        tracks.splice(index, 1);
      }
    });
    if (!track) {
      sendJson(response, 404, { error: "Şarkı bulunamadı." });
      return;
    }
    await fsp.unlink(path.join(MUSIC_DIR, track.file));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Bulunamadı." });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Yönteme izin verilmiyor." });
    return;
  }
  serveStatic(pathname, response);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("İstek işlenemedi:", error);
    if (!response.headersSent) sendJson(response, 500, { error: "Sunucu hatası." });
    else response.destroy(error);
  });
});

server.listen(PORT, () => {
  console.log(`Ritim sunucusu http://localhost:${PORT} adresinde çalışıyor.`);
});
