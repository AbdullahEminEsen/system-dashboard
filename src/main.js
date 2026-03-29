const { app, BrowserWindow, ipcMain, screen } = require('electron')
const si = require('systeminformation')
const axios = require('axios')
const path = require('path')
const Store = require('electron-store')
const store = new Store()

const DEFAULT_LAYOUT = [
  { id: 'card-clock', type: 'single' },
  { id: 'group-1', type: 'group', children: ['card-cpu', 'card-ram'] },
  { id: 'card-gpu', type: 'single' },
  { id: 'group-2', type: 'group', children: ['card-proc', 'card-screen'] },
  { id: 'card-disk', type: 'single' },
  { id: 'card-net', type: 'single' },
  { id: 'card-weather', type: 'single' },
]

const DEFAULT_VISIBLE = [
  'card-clock', 'card-cpu', 'card-ram',
  'card-gpu',
  'card-proc', 'card-screen', 'card-disk',
  'card-net', 'card-weather'
]

let mainWindow
let editorWindow
let settingsWindow

// ── Cache ───────────────────────────────────────────────────────
let cachedDisplay = null
let cachedDisk = null
let lastDiskUpdate = 0
let cachedNet = null
let lastNetUpdate = 0
let cachedProcessCount = 0
let lastProcessUpdate = 0
let cachedCoords = null
let lastCity = null
let cachedGpu = null
let lastGpuUpdate = 0
let isRepositioning = false
let repositionTimer = null

// ── Pencereler ──────────────────────────────────────────────────
function createMainWindow() {
  const bounds = store.get('windowBounds', { width: 420, height: 860 })
  const alwaysOnTop = store.get('alwaysOnTop', true)
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 300,
    maxWidth: 700,
    resizable: true,
    frame: false,
    alwaysOnTop,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  if (alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.once('ready-to-show', () => {
    try {
      mainWindow.setOpacity(store.get('opacity', 1))
    } catch (e) { }
    const zoom = bounds.width / 420
    mainWindow.webContents.setZoomFactor(zoom)
  })

  mainWindow.on('resize', () => {
    if (isRepositioning) return
    const [width, height] = mainWindow.getSize()
    store.set('windowBounds', { width, height })
    const zoom = width / 420
    mainWindow.webContents.setZoomFactor(zoom)
    const baseHeight = store.get('baseHeight', 860)
  const newHeight = Math.round(baseHeight * zoom)
  
  if (height !== newHeight) {
    mainWindow.setSize(width, newHeight)
  }
  
  store.set('windowBounds', { width, height: newHeight })
    repositionChildWindows()
  })

  // Main pencere hareket edince child pencereler de gelsin
  mainWindow.on('move', () => {
    repositionChildWindows()
  })

  mainWindow.on('closed', () => {
    if (editorWindow) editorWindow.close()
    if (settingsWindow) settingsWindow.close()
  })
}

function getChildPosition(index) {
  const { x, y } = mainWindow.getBounds()
  const [mainWidth] = mainWindow.getSize()
  const gap = 8
  // index 0 = ilk pencere (en üstte), index 1 = ikinci pencere (altında)
  const windows = []
  if (editorWindow && !editorWindow.isDestroyed()) windows.push(editorWindow)
  if (settingsWindow && !settingsWindow.isDestroyed()) windows.push(settingsWindow)

  let offsetY = y
  for (let i = 0; i < index; i++) {
    offsetY += windows[i].getSize()[1] + gap
  }

  return { x: x + mainWidth + gap, y: offsetY }
}

function repositionChildWindows() {
  if (repositionTimer) return

  repositionTimer = setTimeout(() => {
    repositionTimer = null
    if (!mainWindow || mainWindow.isDestroyed()) return

    const { x, y } = mainWindow.getBounds()
    const [mainWidth] = mainWindow.getSize()
    const gap = 8
    let offsetY = y

    const windows = []
    if (settingsWindow && !settingsWindow.isDestroyed()) windows.push(settingsWindow)
    if (editorWindow && !editorWindow.isDestroyed()) windows.push(editorWindow)

    windows.forEach(win => {
      win.setPosition(x + mainWidth + gap, offsetY)
      offsetY += win.getSize()[1] + gap
    })
  }, 16) // ~60fps
}

function createEditorWindow() {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus(); return
  }

  const { x, y } = mainWindow.getBounds()
  const [mainWidth] = mainWindow.getSize()
  const gap = 8

  // Settings açıksa editör onun altına gelir
  let offsetY = y
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    offsetY += settingsWindow.getSize()[1] + gap
  }

  editorWindow = new BrowserWindow({
    width: 340, height: 680,
    x: x + mainWidth + gap, y: offsetY,
    resizable: false, frame: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  editorWindow.loadFile(path.join(__dirname, 'editor.html'))
  editorWindow.on('closed', () => {
    editorWindow = null
    repositionChildWindows()
  })
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus(); return
  }

  const { x, y } = mainWindow.getBounds()
  const [mainWidth] = mainWindow.getSize()
  const gap = 8

  // Settings her zaman en üste gelir, editör varsa onun altına kayar
  settingsWindow = new BrowserWindow({
    width: 300, height: 420,
    x: x + mainWidth + gap, y,
    resizable: false, frame: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))
  settingsWindow.on('closed', () => {
    settingsWindow = null
    repositionChildWindows()
  })

  // Settings açılınca editör varsa aşağı kay
  if (editorWindow && !editorWindow.isDestroyed()) {
    const newEditorY = y + 420 + gap
    editorWindow.setPosition(x + mainWidth + gap, newEditorY)
  }
}

app.whenReady().then(() => {
  try {
    const d = screen.getPrimaryDisplay()
    cachedDisplay = {
      width: d.size.width,
      height: d.size.height,
      hz: Math.round(d.displayFrequency || 60)
    }
  } catch { cachedDisplay = { width: '—', height: '—', hz: '—' } }

  createMainWindow()
  mainWindow.once('ready-to-show', () => {
    setTimeout(pushSystemData, 500)
  })
  setInterval(pushSystemData, 4000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Push modeli ─────────────────────────────────────────────────
async function pushSystemData() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const now = Date.now()
    const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()])

    if (!cachedNet) {
      await si.networkStats() // ilk ölçümü at
      await new Promise(r => setTimeout(r, 1000)) // 1 saniye bekle
      cachedNet = await si.networkStats() // ikinci ölçümü al
      lastNetUpdate = now
    }
    if (!cachedDisk) {
      cachedDisk = await si.fsSize()
      lastDiskUpdate = now
    }
    if (!cachedProcessCount) {
      const p = await si.processes()
      cachedProcessCount = p.all
      lastProcessUpdate = now
    }
    if (!cachedGpu) {
      try {
        const gpuData = await si.graphics()
        const controller = gpuData.controllers?.[0]
        cachedGpu = {
          name: controller?.model ?? '—',
          vram: controller?.vram ?? null,
          vramUsed: controller?.memoryUsed ?? null,
          vramFree: controller?.memoryFree ?? null,
          load: controller?.utilizationGpu ?? null,
          memLoad: controller?.utilizationMemory ?? null,
          temp: controller?.temperatureGpu ?? null,
          power: controller?.powerDraw ?? null,
          vendor: controller?.vendor ?? ''
        }
      } catch { cachedGpu = null }
      lastGpuUpdate = now
    }

    // GPU — her 5 saniyede bir
    if (now - lastGpuUpdate > 5000) {
      try {
        const gpuData = await si.graphics()
        const controller = gpuData.controllers?.[0]
        cachedGpu = {
          name: controller?.model ?? '—',
          vram: controller?.vram ?? null,
          vramUsed: controller?.memoryUsed ?? null,
          vramFree: controller?.memoryFree ?? null,
          load: controller?.utilizationGpu ?? null,
          memLoad: controller?.utilizationMemory ?? null,
          temp: controller?.temperatureGpu ?? null,
          power: controller?.powerDraw ?? null,
          vendor: controller?.vendor ?? ''
        }
      } catch { cachedGpu = null }
      lastGpuUpdate = now
    }

    if (now - lastNetUpdate > 10000) {
      await si.networkStats() // ilk ölçümü at
      await new Promise(r => setTimeout(r, 1000))
      cachedNet = await si.networkStats()
      lastNetUpdate = now
    }
    if (now - lastDiskUpdate > 30000) {
      cachedDisk = await si.fsSize()
      lastDiskUpdate = now
    }
    if (now - lastProcessUpdate > 15000) {
      const p = await si.processes()
      cachedProcessCount = p.all
      lastProcessUpdate = now
    }

    const time = await si.time()
    const h = Math.floor(time.uptime / 3600)
    const m = Math.floor((time.uptime % 3600) / 60)

    mainWindow.webContents.send('system-update', {
      cpu: Math.round(cpu.currentLoad),
      ram: {
        used: (mem.used / 1024 / 1024 / 1024).toFixed(1),
        total: (mem.total / 1024 / 1024 / 1024).toFixed(1),
        percent: Math.round((mem.used / mem.total) * 100)
      },
      net: {
        download: cachedNet?.[0] ? (cachedNet[0].rx_sec / 1024 / 1024).toFixed(1) : '0.0',
        upload: cachedNet?.[0] ? (cachedNet[0].tx_sec / 1024 / 1024).toFixed(1) : '0.0'
      },
      disk: {
        percent: cachedDisk?.[0] ? Math.round((cachedDisk[0].used / cachedDisk[0].size) * 100) : 0,
        free: cachedDisk?.[0] ? (cachedDisk[0].available / 1024 / 1024 / 1024).toFixed(1) : '—'
      },
      display: cachedDisplay,
      processes: { all: cachedProcessCount },
      uptime: `${h}s ${m}dk`,
      gpu: cachedGpu
    })
  } catch (e) { }
}

// ── Hava durumu ─────────────────────────────────────────────────
ipcMain.handle('get-weather', async () => {
  try {
    const city = store.get('city', null)
    if (!city) return { temp: '—', desc: '—', humidity: '—', city: '—' }
    if (city !== lastCity || !cachedCoords) {
      const geoRes = await axios.get(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr`
      )
      const loc = geoRes.data.results?.[0]
      if (!loc) return { temp: '—', desc: 'Şehir bulunamadı', humidity: '—', city }
      cachedCoords = { lat: loc.latitude, lon: loc.longitude, name: loc.name }
      lastCity = city
    }
    const weatherRes = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${cachedCoords.lat}&longitude=${cachedCoords.lon}&current=temperature_2m,weathercode,relative_humidity_2m&timezone=auto`
    )
    const c = weatherRes.data.current
    const codes = {
      0: 'Açık', 1: 'Az bulutlu', 2: 'Parçalı bulutlu', 3: 'Bulutlu',
      45: 'Sisli', 51: 'Çisenti', 61: 'Yağmurlu', 71: 'Karlı',
      80: 'Sağanak', 95: 'Fırtına'
    }
    return {
      temp: Math.round(c.temperature_2m),
      desc: codes[c.weathercode] || 'Bilinmiyor',
      humidity: c.relative_humidity_2m,
      city: cachedCoords.name
    }
  } catch { return { temp: '—', desc: 'Bağlanamadı', humidity: '—', city: '—' } }
})

// ── Store handlers ──────────────────────────────────────────────
ipcMain.handle('get-city', () => store.get('city', null))
ipcMain.on('set-city', (_, city) => {
  store.set('city', city)
  cachedCoords = null
  lastCity = null
})

ipcMain.handle('get-theme', () => store.get('theme', 'dark'))
ipcMain.on('set-theme', (_, theme) => {
  store.set('theme', theme)
  if (mainWindow) mainWindow.webContents.send('theme-changed', theme)
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.webContents.send('theme-changed', theme)
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('theme-changed', theme)
})

ipcMain.handle('get-layout', () => store.get('layout', DEFAULT_LAYOUT))
ipcMain.on('set-layout', (_, layout) => {
  store.set('layout', layout)
  if (mainWindow) mainWindow.webContents.send('layout-updated', layout)
})

ipcMain.handle('get-visible', () => store.get('visibleCards', DEFAULT_VISIBLE))
ipcMain.on('set-visible', (_, visible) => {
  store.set('visibleCards', visible)
  if (mainWindow) mainWindow.webContents.send('visible-updated', visible)
})

ipcMain.on('set-window-height', (_, height) => {
  if (mainWindow) {
    store.set('baseHeight', height) // zoom'suz orijinal yükseklik
    const [currentWidth] = mainWindow.getSize()
    const zoom = currentWidth / 420
    const scaledHeight = Math.round(height * zoom)
    store.set('windowBounds', { width: currentWidth, height: scaledHeight })
    mainWindow.setSize(currentWidth, scaledHeight)
  }
})

ipcMain.handle('get-always-on-top', () => store.get('alwaysOnTop', true))
ipcMain.on('set-always-on-top', (_, val) => {
  store.set('alwaysOnTop', val)
  if (mainWindow) {
    if (val) mainWindow.setAlwaysOnTop(true, 'screen-saver')
    else mainWindow.setAlwaysOnTop(false)
  }
})

ipcMain.handle('get-opacity', () => store.get('opacity', 1))
ipcMain.on('set-opacity', (_, val) => {
  store.set('opacity', val)
  if (mainWindow) {
    try {
      mainWindow.setOpacity(val)
    } catch (e) {
      // Linux'ta compositor yoksa sessizce geç
      console.log('Opacity not supported on this platform')
    }
  }
})

ipcMain.on('open-editor', () => createEditorWindow())
ipcMain.on('close-editor', () => { if (editorWindow) editorWindow.close() })
ipcMain.on('open-settings', () => createSettingsWindow())
ipcMain.on('close-settings', () => { if (settingsWindow) settingsWindow.close() })
ipcMain.on('close-app', () => app.quit())