# System Dashboard

Masaüstünde her zaman üstte duran, gerçek zamanlı sistem bilgilerini gösteren bir Electron uygulaması.

![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)

## Özellikler

- 🖥️ Gerçek zamanlı CPU & RAM kullanımı
- 💾 Disk kullanımı ve boş alan
- 🌐 Ağ hızı (indirme / yükleme)
- ⚙️ Açık işlem sayısı
- 🖥️ Ekran çözünürlüğü & yenileme hızı
- 🌤️ Hava durumu (şehir seçilebilir)
- 🕐 Saat & tarih
- ⏱️ Sistem uptime
- 🌙 Aydınlık / Karanlık mod

## Ekran Görüntüleri

| Karanlık Mod | Aydınlık Mod |
|---|---|
| ![dark](screenshots/dark.png) | ![light](screenshots/light.png) |

## Kurulum

### Gereksinimler

- [Node.js](https://nodejs.org) (LTS)
- [Git](https://git-scm.com)

### Adımlar

```bash
# Repoyu klonla
git clone https://github.com/KULLANICI_ADIN/system-dashboard.git

# Klasöre gir
cd system-dashboard

# Bağımlılıkları yükle
npm install

# Uygulamayı başlat
npm start
```

## Kullanılan Teknolojiler

| Teknoloji | Açıklama |
|---|---|
| [Electron](https://www.electronjs.org/) | Masaüstü uygulama çatısı |
| [systeminformation](https://systeminformation.io/) | Sistem bilgisi okuma |
| [electron-store](https://github.com/sindresorhus/electron-store) | Ayarların kalıcı kaydı |
| [axios](https://axios-http.com/) | HTTP istekleri |
| [Open-Meteo API](https://open-meteo.com/) | Ücretsiz hava durumu API'si |
| [Lucide Icons](https://lucide.dev/) | İkon seti |

## Lisans

MIT
