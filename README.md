# Ritim

Ortak bir müzik kütüphanesi ve tarayıcı tabanlı oynatıcı. Ziyaretçiler sunucudaki şarkıları dinleyebilir; yükleme ve silme işlemleri yalnızca yönetici parolasıyla yapılır.

## Yerel çalıştırma

Node.js 18 veya üzeri kurulu olmalı. Proje klasöründe PowerShell açıp güçlü, gizli bir yönetici parolası belirle ve sunucuyu başlat:

```powershell
$env:ADMIN_PASSWORD = "buraya-guclu-bir-parola"
node server.js
```

Ardından `http://localhost:8000` adresini aç. Komutu çalıştırdığın PowerShell penceresi açık kaldığı sürece sunucu çalışır. Başka bir cihazdan denemek için aynı ağdaki bu bilgisayarın yerel IP adresini ve `8000` portunu kullanabilirsin; güvenlik duvarının bağlantıyı engellemediğinden emin ol.

## Şarkı ekleme ve erişim

Uygulamada yönetici simgesine veya **Yönetici girişi** düğmesine bas, parolayı gir ve dosyaları seç. MP3, WAV, M4A, AAC, OGG, OPUS ve FLAC dahil desteklenen ses dosyaları yüklenebilir; dosya başına sınır 100 MB'tır. Yüklenen şarkılar `music` klasöründe saklanır ve bu sunucuya bağlanan herkes tarafından görülebilir/dinlenebilir. Yönetici oturumu tarayıcı yenilendiğinde kapanır.

Uygulamayı internette herkese açmak için Node sunucusunu kalıcı dosya depolama sağlayan bir hostinge dağıt, `ADMIN_PASSWORD` değerini hostingin gizli ortam değişkeni ayarına ekle ve HTTPS kullan. Sunucudaki `music` klasörünü kalıcı depolamaya bağla; geçici dosya sistemi kullanan hostinglerde dosyalar yeniden başlatmada silinebilir. Yönetici parolasını kimseyle paylaşma.

## Telif ve lisans

Yalnızca sahibi olduğun veya lisansı herkese dağıtıp dinletmene izin veren müzikleri yükle. Sanatçıların/resmî mağazaların indirmeye açtığı parçaları veya dağıtım izni açıkça verilmiş lisanslı müzikleri tercih et; Jamendo, Free Music Archive ve Internet Archive gibi kaynaklarda her parçanın lisansını ayrıca kontrol et. YouTube'dan izinsiz kaydedilmiş telifli şarkıları herkese açık biçimde dağıtma; Spotify çevrimdışı indirmeleri de normal MP3 dosyası değildir.
