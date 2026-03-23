# System Dashboard

Masaüstünde her zaman üstte duran, gerçek zamanlı sistem bilgilerini gösteren bir Electron uygulaması.

![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)

## Ekran Görüntüleri

### Ana Widget
| Karanlık Mod | Aydınlık Mod |
|---|---|
| ![dark](screenshots/dark.png) | ![light](screenshots/light.png) |

### Kart Düzenleyici
| Karanlık Mod | Aydınlık Mod |
|---|---|
| ![editor_dark](screenshots/editor_dark.png) | ![editor_light](screenshots/editor_light.png) |

### Ayarlar
| Karanlık Mod | Aydınlık Mod |
|---|---|
| ![settings_dark](screenshots/settings_dark.png) | ![settings_light](screenshots/settings_light.png) |

## Özellikler

### Sistem Bilgileri
- 🖥️ Gerçek zamanlı CPU & RAM kullanımı
- 💾 Disk kullanımı ve boş alan
- 🌐 Ağ hızı (indirme / yükleme)
- ⚙️ Açık işlem sayısı
- 🖥️ Ekran çözünürlüğü & yenileme hızı
- 🌤️ Hava durumu (şehir seçilebilir)
- 🕐 Saat & tarih
- ⏱️ Sistem uptime

### Özelleştirme
- 🃏 Kartları sürükleyerek yeniden sırala
- 👁️ İstediğin kartları gizle / göster
- 🔲 Kartları yan yana grupla (compact mod)
- 🌙 Aydınlık / Karanlık mod
- 📐 Kenardan sürükleyerek boyutlandır (orantılı ölçekleme)

### Ayarlar Penceresi
- 📌 Her zaman üstte kal (oyun modu dahil)
- 🫥 Saydamlık (4 farklı opaklık seviyesi)
- 🌙 Tema değiştirme

### Performans
- Hafif veriler (CPU, RAM) 4 saniyede bir güncellenir
- Ağ verisi 10 saniyede bir güncellenir
- Disk & işlem sayısı 15-30 saniyede bir güncellenir
- Push modeli ile IPC spam önlenir
- Ekran bilgisi, disk ve işlem sayısı cache'lenerek gereksiz sorgular azaltılır

## Kurulum

### Gereksinimler
- [Node.js](https://nodejs.org) (LTS)
- [Git](https://git-scm.com)

### Adımlar

```bash
# Repoyu klonla
git clone https://github.com/AbdullahEminEsen/system-dashboard.git

# Klasöre gir
cd system-dashboard

# Bağımlılıkları yükle
npm install

# Uygulamayı başlat
npm start
```

### Build (Kurulum dosyası oluştur)

```bash
npm run build
```

`dist` klasöründe `System Dashboard Setup x.x.x.exe` dosyası oluşur.

## Kullanım

| Buton | İşlev |
|---|---|
| ☀️ / 🌙 | Aydınlık / Karanlık mod geçişi |
| ⚙️ | Ayarlar penceresini aç |
| ⠿ | Kart düzenleyiciyi aç |
| ✕ | Uygulamayı kapat |

### Kart Düzenleyici
- Kartları sürükleyerek sırala
- Göz ikonuyla kartları gizle veya göster
- Panel ikonu ile iki kartı yan yana grupla
- Gizli kartları tekrar ekle

### Boyutlandırma
Pencerenin kenarından tutup sürükleyerek genişletebilir veya daraltabilirsin. İçerik orantılı olarak ölçeklenir.

### Ayarlar
- **Tema** — Aydınlık / Karanlık mod toggle
- **Saydamlık** — 4 farklı opaklık seviyesi (%100, %80, %60, %40)
- **Her zaman üstte** — Oyunlar dahil tüm pencerelerin üzerinde kalır

## Kullanılan Teknolojiler

| Teknoloji | Açıklama |
|---|---|
| [Electron](https://www.electronjs.org/) | Masaüstü uygulama çatısı |
| [systeminformation](https://systeminformation.io/) | Sistem bilgisi okuma |
| [electron-store](https://github.com/sindresorhus/electron-store) | Ayarların kalıcı kaydı |
| [axios](https://axios-http.com/) | HTTP istekleri |
| [Open-Meteo API](https://open-meteo.com/) | Ücretsiz hava durumu API'si |
| [Lucide Icons](https://lucide.dev/) | İkon seti |
| [SortableJS](https://sortablejs.github.io/Sortable/) | Sürükle bırak |

## Lisans

MIT
