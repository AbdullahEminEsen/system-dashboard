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

> Linux and macOS builds are coming soon.

## Features

### System Info
- 🖥️ Real-time CPU & RAM usage
- 💾 Disk usage and free space
- 🌐 Network speed (download / upload)
- ⚙️ Running process count
- 🖥️ Screen resolution & refresh rate
- 🌤️ Weather (city selectable)
- 🕐 Clock & date
- ⏱️ System uptime

### Customization
- 🃏 Drag cards to reorder
- 👁️ Show / hide individual cards
- 🔲 Group cards side by side (compact mode)
- 🌙 Light / Dark mode
- 📐 Drag window edges to resize (proportional scaling)

### Settings Panel
- 📌 Always on top (works in games too)
- 🫥 Transparency (4 opacity levels)
- 🌙 Theme toggle

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
| ✕ | Close the app |

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
