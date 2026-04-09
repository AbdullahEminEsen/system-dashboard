# System Dashboard

A lightweight Electron-based desktop widget that displays real-time system information, always sitting on top of your other windows.

![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)

## Screenshots

### Main Widget
| Dark Mode | Light Mode |
|---|---|
| ![dark](screenshots/dark.png) | ![light](screenshots/light.png) |

### Card Editor
| Dark Mode | Light Mode |
|---|---|
| ![editor_dark](screenshots/editor_dark.png) | ![editor_light](screenshots/editor_light.png) |

### Settings
| Dark Mode | Light Mode |
|---|---|
| ![settings_dark](screenshots/settings_dark.png) | ![settings_light](screenshots/settings_light.png) |

## Download

Head over to the [Releases](https://github.com/AbdullahEminEsen/system-dashboard/releases) page to download the latest version.

| File | Description |
|---|---|
| `System Dashboard Setup x.x.x.exe` | Windows installer (recommended) |
| `System Dashboard x.x.x.exe` | Windows portable, no installation needed |
| `System Dashboard-x.x.x-arm64.dmg` | macOS Apple Silicon (M1/M2/M3) |
| `System Dashboard-x.x.x-x64.dmg` | macOS Intel |
| `System Dashboard-x.x.x.AppImage` | Linux |

> **⚠️ Windows:** You may see a SmartScreen warning. Click **"More info"** → **"Run anyway"**. The app is open source and safe to install.

> **🍎 macOS:** Full macOS support is currently being tested and improved. Some features (e.g. transparency) may behave differently depending on your system.

> **🐧 Linux:** Tested on Debian 12. Transparency is not supported on Wayland sessions without a compositor.

## Features

### System Info
- 🖥️ Real-time CPU & RAM usage
- 💾 Disk usage and free space
- 🌐 Network speed (download / upload)
- ⚙️ Running process count
- 🖥️ Screen resolution & refresh rate (multi-display support)
- 🎮 GPU usage, temperature, VRAM & power draw (NVIDIA full support, AMD model info only)
- 🌤️ Weather (city selectable)
- 🕐 Clock & date
- ⏱️ System uptime

### Customization
- 🃏 Drag cards to reorder
- 👁️ Show / hide individual cards
- 🔲 Group cards side by side (compact mode)
- 🌙 Light / Dark mode
- 📐 Drag window edges to resize (proportional scaling)
- 🖥️ Select active GPU and display from a dropdown

### Settings Panel
- 📌 Always on top (works in games too)
- 🫥 Transparency (4 opacity levels)
- 🌙 Theme toggle

### System Tray
- App runs in the background when closed
- Click tray icon to show / hide the widget
- Right-click for quick access to Settings and Card Editor

### Performance
- Light data (CPU, RAM) updates every 4 seconds
- Network data updates every 10 seconds
- Disk & process count updates every 15–30 seconds
- Push model prevents IPC spam
- Display info, disk and process count are cached to reduce unnecessary queries

## Installation (from source)

### Requirements
- [Node.js](https://nodejs.org) (LTS)
- [Git](https://git-scm.com)

### Steps

```bash
# Clone the repository
git clone https://github.com/AbdullahEminEsen/system-dashboard.git

# Navigate to the project folder
cd system-dashboard

# Install dependencies
npm install

# Start the app
npm start
```

### Build

```bash
npm run build
```

The installer will be generated in the `dist` folder.

## Usage

| Button | Action |
|---|---|
| ☀️ / 🌙 | Toggle light / dark mode |
| ⚙️ | Open settings |
| ⠿ | Open card editor |
| ✕ | Minimize to tray |

### Card Editor
- Drag slots to reorder cards
- Toggle visibility with the eye icon
- Group two cards side by side using the panel icon
- Re-add hidden cards from the pool below

### Resizing
Drag any edge of the window to resize. The content scales proportionally.

### Settings
- **Theme** — Toggle between light and dark mode
- **Opacity** — Choose from 4 transparency levels (100%, 80%, 60%, 40%)
- **Always on top** — Stay above all windows, including fullscreen games

### System Tray
The app minimizes to the system tray when closed. Click the tray icon to show or hide the widget. Right-click for quick access to Settings, Card Editor, and Quit.

## Platform Support

| Feature | Windows | macOS | Linux |
|---|---|---|---|
| CPU & RAM | ✅ | ✅ | ✅ |
| GPU (NVIDIA) | ✅ | ✅ | ✅ |
| GPU (AMD) | ⚠️ Model only | ⚠️ Model only | ⚠️ Model only |
| Temperature | ✅ NVIDIA | ✅ NVIDIA | ✅ NVIDIA |
| Transparency | ✅ | ✅ | ⚠️ X11 only |
| Always on top | ✅ | ✅ | ✅ |
| System tray | ✅ | ✅ | ✅ |
| Multi-display | ✅ | ✅ | ✅ |

> macOS support is actively being tested and improved.

## Tech Stack

| Technology | Purpose |
|---|---|
| [Electron](https://www.electronjs.org/) | Desktop app framework |
| [systeminformation](https://systeminformation.io/) | System data access |
| [electron-store](https://github.com/sindresorhus/electron-store) | Persistent settings storage |
| [axios](https://axios-http.com/) | HTTP requests |
| [Open-Meteo API](https://open-meteo.com/) | Free weather API |
| [Lucide Icons](https://lucide.dev/) | Icon set |
| [SortableJS](https://sortablejs.github.io/Sortable/) | Drag and drop |

## License

MIT
