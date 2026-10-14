const audio = document.querySelector("#audio-player");
const fileInput = document.querySelector("#file-input");
const trackList = document.querySelector("#track-list");
const emptyState = document.querySelector("#empty-state");
const noResults = document.querySelector("#no-results");
const searchInput = document.querySelector("#search-input");
const playButton = document.querySelector("#play-button");
const progressInput = document.querySelector("#progress-input");
const currentTimeLabel = document.querySelector("#current-time");
const durationLabel = document.querySelector("#duration-time");
const playerTitle = document.querySelector("#player-title");
const playerArtist = document.querySelector("#player-artist");
const playerCover = document.querySelector("#player-cover");
const trackCount = document.querySelector("#track-count");
const toast = document.querySelector("#toast");
const adminLoginButton = document.querySelector("#admin-login-button");
const adminLogoutButton = document.querySelector("#admin-logout-button");
const libraryStatus = document.querySelector("#library-status");

let tracks = [];
let currentTrackId = null;
let toastTimer;
let adminAuthorization = null;

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function fileExtension(name) {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toUpperCase() : "SES";
}

function setAdminState(isAdmin) {
  adminLoginButton.hidden = isAdmin;
  adminLogoutButton.hidden = !isAdmin;
  libraryStatus.textContent = isAdmin ? "Yönetici olarak giriş yapıldı" : "Ortak müzik kütüphanesi";
  renderTracks();
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers);
  if (adminAuthorization) headers.set("Authorization", adminAuthorization);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let message = `İstek başarısız (${response.status}).`;
    try {
      const result = await response.json();
      if (typeof result.error === "string") message = result.error;
    } catch {
      // Keep the HTTP error visible if the server did not return JSON.
    }
    throw new Error(message);
  }
  return response;
}

function renderTracks() {
  const query = searchInput.value.trim().toLocaleLowerCase("tr");
  const visibleTracks = tracks.filter((track) => track.name.toLocaleLowerCase("tr").includes(query));
  trackList.replaceChildren();
  trackCount.textContent = `${tracks.length} şarkı`;
  playButton.disabled = tracks.length === 0;
  emptyState.hidden = tracks.length > 0;
  noResults.hidden = tracks.length === 0 || visibleTracks.length > 0;

  for (const [index, track] of visibleTracks.entries()) {
    const row = document.createElement("div");
    row.className = `track-row${track.id === currentTrackId ? " is-current" : ""}`;
    row.setAttribute("role", "row");
    row.tabIndex = 0;
    row.setAttribute("aria-label", `${track.name}, ${formatTime(track.duration)}`);

    const number = document.createElement("span");
    number.className = "track-number";
    number.setAttribute("role", "cell");
    number.textContent = track.id === currentTrackId && !audio.paused ? "♫" : String(index + 1);

    const info = document.createElement("span");
    info.className = "track-info";
    info.setAttribute("role", "cell");
    const cover = document.createElement("span");
    cover.className = "track-cover";
    cover.setAttribute("aria-hidden", "true");
    cover.textContent = "♫";
    const text = document.createElement("span");
    text.style.minWidth = "0";
    const name = document.createElement("span");
    name.className = "track-name";
    name.textContent = track.name.replace(/\.[^.]+$/, "");
    const subtitle = document.createElement("span");
    subtitle.className = "track-subtitle";
    subtitle.textContent = "Ortak kütüphane";
    text.append(name, subtitle);
    info.append(cover, text);

    const type = document.createElement("span");
    type.className = "track-filetype";
    type.setAttribute("role", "cell");
    type.textContent = fileExtension(track.name);

    const duration = document.createElement("span");
    duration.className = "track-duration";
    duration.setAttribute("role", "cell");
    duration.textContent = formatTime(track.duration);

    const remove = document.createElement("button");
    remove.className = "remove-track";
    remove.type = "button";
    remove.hidden = !adminAuthorization;
    remove.setAttribute("aria-label", `${track.name} şarkısını kütüphaneden sil`);
    remove.title = "Kütüphaneden kaldır";
    remove.textContent = "×";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await request(`/api/tracks/${encodeURIComponent(track.id)}`, { method: "DELETE" });
        if (currentTrackId === track.id) resetPlayer();
        await loadTracks();
        showToast("Şarkı ortak kütüphaneden kaldırıldı.");
      } catch (error) {
        showToast(error.message);
      }
    });

    row.append(number, info, type, duration, remove);
    row.addEventListener("click", () => playTrack(track.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        playTrack(track.id);
      }
    });
    trackList.append(row);
  }
}

async function loadTracks() {
  const response = await request("/api/tracks");
  tracks = await response.json();
  renderTracks();
}

async function signIn() {
  const password = window.prompt("Yönetici parolasını gir:");
  if (password === null) return false;
  const encodedCredentials = new TextEncoder().encode(`admin:${password}`);
  adminAuthorization = `Basic ${btoa(String.fromCharCode(...encodedCredentials))}`;
  try {
    await request("/api/admin/session", { method: "POST" });
    setAdminState(true);
    showToast("Yönetici girişi başarılı.");
    return true;
  } catch (error) {
    adminAuthorization = null;
    setAdminState(false);
    showToast(error.message === "Yetkisiz." ? "Parola hatalı." : error.message);
    return false;
  }
}

async function openUploadPicker() {
  if (!adminAuthorization && !(await signIn())) return;
  fileInput.click();
}

async function uploadFiles(files) {
  let uploaded = 0;
  const failures = [];
  for (const file of files) {
    const name = file.name.trim();
    if (!name) continue;
    try {
      const duration = await readDuration(file);
      const params = new URLSearchParams({ name, duration: String(duration) });
      await request(`/api/tracks?${params}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      uploaded += 1;
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      if (error.message === "Yetkisiz.") {
        adminAuthorization = null;
        setAdminState(false);
        showToast("Yönetici oturumu geçersiz. Yeniden giriş yap.");
        return;
      }
    }
  }
  await loadTracks();
  if (uploaded > 0) showToast(`${uploaded} şarkı ortak kütüphaneye eklendi.`);
  if (failures.length > 0) {
    const details = failures.slice(0, 3).join(" · ");
    const remaining = failures.length > 3 ? ` · ve ${failures.length - 3} dosya daha` : "";
    showToast(`Yüklenemeyen ${failures.length} dosya: ${details}${remaining}`);
  }
}

function readDuration(file) {
  const url = URL.createObjectURL(file);
  const probe = new Audio();
  probe.preload = "metadata";
  probe.src = url;
  return new Promise((resolve) => {
    const finish = () => {
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      probe.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    probe.addEventListener("loadedmetadata", finish, { once: true });
    probe.addEventListener("error", finish, { once: true });
  });
}

async function playTrack(id) {
  const track = tracks.find((item) => item.id === id);
  if (!track) return;
  if (currentTrackId !== id) {
    currentTrackId = id;
    audio.src = `/api/tracks/${encodeURIComponent(id)}/audio`;
    playerTitle.textContent = track.name.replace(/\.[^.]+$/, "");
    playerArtist.textContent = "Ortak kütüphane";
    playerCover.textContent = "♫";
    progressInput.value = "0";
    currentTimeLabel.textContent = "0:00";
    durationLabel.textContent = formatTime(track.duration);
  }
  try {
    await audio.play();
    renderTracks();
  } catch (error) {
    showToast(`“${track.name}” çalınamadı. Dosya biçimini ve tarayıcı desteğini kontrol et.`);
    console.error("Ses dosyası oynatılamadı:", error);
  }
}

function resetPlayer() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  currentTrackId = null;
  playerTitle.textContent = "Bir şarkı seç";
  playerArtist.textContent = "Ortak kütüphane";
  playerCover.textContent = "♫";
  playButton.textContent = "▶";
  playButton.setAttribute("aria-label", "Oynat");
  progressInput.disabled = true;
  currentTimeLabel.textContent = "0:00";
  durationLabel.textContent = "0:00";
}

function togglePlayback() {
  if (!currentTrackId) {
    if (tracks.length > 0) playTrack(tracks[0].id);
  } else if (audio.paused) {
    audio.play().catch((error) => {
      showToast("Şarkı yeniden başlatılamadı.");
      console.error("Ses dosyası oynatılamadı:", error);
    });
  } else {
    audio.pause();
  }
}

function stepTrack(direction) {
  if (tracks.length === 0) return;
  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : tracks.length - 1)
    : (currentIndex + direction + tracks.length) % tracks.length;
  playTrack(tracks[nextIndex].id);
}

for (const button of document.querySelectorAll("#add-button, #welcome-add-button, #empty-add-button")) {
  button.addEventListener("click", openUploadPicker);
}

adminLoginButton.addEventListener("click", signIn);
adminLogoutButton.addEventListener("click", () => {
  adminAuthorization = null;
  setAdminState(false);
  showToast("Yönetici oturumu kapatıldı.");
});
fileInput.addEventListener("change", async () => {
  try {
    await uploadFiles(Array.from(fileInput.files ?? []));
  } catch (error) {
    showToast(`Şarkılar yüklenemedi: ${error.message}`);
    console.error("Şarkılar ortak kütüphaneye yüklenemedi:", error);
  } finally {
    fileInput.value = "";
  }
});
searchInput.addEventListener("input", renderTracks);
document.querySelector("#search-link").addEventListener("click", () => {
  window.setTimeout(() => searchInput.focus(), 0);
});
playButton.addEventListener("click", togglePlayback);
document.querySelector("#previous-button").addEventListener("click", () => stepTrack(-1));
document.querySelector("#next-button").addEventListener("click", () => stepTrack(1));
document.querySelector("#volume-input").addEventListener("input", (event) => {
  audio.volume = Number(event.currentTarget.value);
});
progressInput.addEventListener("input", () => {
  if (Number.isFinite(audio.duration)) {
    audio.currentTime = (Number(progressInput.value) / 1000) * audio.duration;
  }
});
audio.addEventListener("timeupdate", () => {
  currentTimeLabel.textContent = formatTime(audio.currentTime);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    progressInput.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  }
});
audio.addEventListener("loadedmetadata", () => {
  durationLabel.textContent = formatTime(audio.duration);
  progressInput.disabled = false;
});
audio.addEventListener("play", () => {
  playButton.textContent = "Ⅱ";
  playButton.setAttribute("aria-label", "Duraklat");
  renderTracks();
});
audio.addEventListener("pause", () => {
  playButton.textContent = "▶";
  playButton.setAttribute("aria-label", "Oynat");
  renderTracks();
});
audio.addEventListener("ended", () => {
  if (tracks.length > 1) stepTrack(1);
});

loadTracks().catch((error) => {
  showToast(`Ortak kütüphane yüklenemedi: ${error.message}`);
  console.error("Ortak müzik kütüphanesi yüklenemedi:", error);
});
