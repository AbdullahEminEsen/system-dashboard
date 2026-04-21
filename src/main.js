const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron')
const si = require('systeminformation')
const axios = require('axios')
const path = require('path')
const Store = require('electron-store')
const store = new Store()
const i18n = require('./i18n')
const { execSync } = require('child_process')

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
let tray = null
let editorWindow
let settingsWindow
let benchmarkWindow = null

app.isQuitting = false

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
let repositionTimer = null
let isSettingHeight = false
let selectedGpuIndex = store.get('selectedGpuIndex', 0)
let selectedDisplayIndex = store.get('selectedDisplayIndex', 0)
let allGpus = []
let allDisplays = []

// ── Pencereler ──────────────────────────────────────────────────
function createMainWindow() {
  const bounds = store.get('windowBounds', { width: 420, height: 860 })
  const alwaysOnTop = store.get('alwaysOnTop', true)
  mainWindow = new BrowserWindow({
    width: bounds.width, height: bounds.height,
    minWidth: 300, maxWidth: 700,
    resizable: true, frame: false, alwaysOnTop,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  if (alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.once('ready-to-show', () => {
    try { mainWindow.setOpacity(store.get('opacity', 1)) } catch (e) { }
    const zoom = bounds.width / 420
    mainWindow.webContents.setZoomFactor(zoom)
  })

  mainWindow.on('resize', () => {
    if (isSettingHeight) return
    const [width] = mainWindow.getSize()
    const zoom = width / 420
    const expectedHeight = Math.round(store.get('baseHeight', 860) * zoom)
    store.set('windowBounds', { width, height: expectedHeight })
    mainWindow.webContents.setZoomFactor(zoom)
    isSettingHeight = true
    mainWindow.setSize(width, expectedHeight)
    setTimeout(() => { isSettingHeight = false; repositionChildWindows() }, 200)
  })

  mainWindow.on('move', () => repositionChildWindows())

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
      return false
    }
  })
}

function updateTrayMenu(t) {
  if (!tray) return
  const contextMenu = Menu.buildFromTemplate([
    {
      label: t.showHide,
      click: () => {
        if (mainWindow.isVisible()) mainWindow.hide()
        else { mainWindow.show(); mainWindow.focus() }
      }
    },
    { type: 'separator' },
    { label: t.settings, click: () => { mainWindow.show(); createSettingsWindow() } },
    { label: t.editor, click: () => { mainWindow.show(); createEditorWindow() } },
    { type: 'separator' },
    { label: t.quit, click: () => { app.isQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(contextMenu)
}

function createTray() {
  let icon
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png'))
    icon = icon.resize({ width: 16, height: 16 })
  } catch { icon = nativeImage.createEmpty() }

  tray = new Tray(icon)
  tray.setToolTip('System Dashboard')

  const lang = store.get('lang', 'tr')
  updateTrayMenu(i18n[lang])

  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  })
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
    if (settingsWindow && !settingsWindow.isDestroyed()) windows.push({ win: settingsWindow, w: 300, h: 420 })
    if (editorWindow && !editorWindow.isDestroyed()) windows.push({ win: editorWindow, w: 340, h: 680 })
    if (benchmarkWindow && !benchmarkWindow.isDestroyed()) windows.push({ win: benchmarkWindow, w: 420, h: 600 })

    windows.forEach(({ win, w, h }) => {
      win.setBounds({ x: x + mainWidth + gap, y: offsetY, width: w, height: h })
      offsetY += h + gap
    })
  }, 16)
}

function createEditorWindow() {
  if (editorWindow && !editorWindow.isDestroyed()) { editorWindow.focus(); return }
  const { x, y } = mainWindow.getBounds()
  const [mainWidth] = mainWindow.getSize()
  const gap = 8
  let offsetY = y
  if (settingsWindow && !settingsWindow.isDestroyed()) offsetY += settingsWindow.getSize()[1] + gap
  editorWindow = new BrowserWindow({
    width: 340, height: 680,
    x: x + mainWidth + gap, y: offsetY,
    resizable: false, frame: false, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  editorWindow.loadFile(path.join(__dirname, 'editor.html'))
  editorWindow.on('closed', () => { editorWindow = null; repositionChildWindows() })
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return }
  const { x, y } = mainWindow.getBounds()
  const [mainWidth] = mainWindow.getSize()
  const gap = 8
  settingsWindow = new BrowserWindow({
    width: 300, height: 420,
    x: x + mainWidth + gap, y,
    resizable: false, frame: false, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))
  settingsWindow.on('closed', () => { settingsWindow = null; repositionChildWindows() })
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.setPosition(x + mainWidth + gap, y + 420 + gap)
  }
}

function createBenchmarkWindow() {
  if (benchmarkWindow && !benchmarkWindow.isDestroyed()) { benchmarkWindow.focus(); return }
  const { x, y } = mainWindow.getBounds()
  const [mainWidth] = mainWindow.getSize()
  const gap = 8
  let offsetY = y
  if (settingsWindow && !settingsWindow.isDestroyed()) offsetY += settingsWindow.getSize()[1] + gap
  if (editorWindow && !editorWindow.isDestroyed()) offsetY += editorWindow.getSize()[1] + gap
  benchmarkWindow = new BrowserWindow({
    width: 420, height: 600,
    x: x + mainWidth + gap, y: offsetY,
    resizable: false, frame: false, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  benchmarkWindow.loadFile(path.join(__dirname, 'benchmark.html'))
  benchmarkWindow.on('closed', () => { benchmarkWindow = null; repositionChildWindows() })
}

app.whenReady().then(async () => {
  try {
    const displays = screen.getAllDisplays()
    allDisplays = displays.map((d, i) => ({
      index: i,
      name: `Display ${i + 1} (${d.size.width}x${d.size.height})`,
      width: d.size.width, height: d.size.height,
      hz: Math.round(d.displayFrequency || 60)
    }))
    const sel = allDisplays[selectedDisplayIndex] || allDisplays[0]
    cachedDisplay = { width: sel.width, height: sel.height, hz: sel.hz }
  } catch { cachedDisplay = { width: '—', height: '—', hz: '—' } }

  try {
    const gpuData = await si.graphics()
    allGpus = gpuData.controllers.map((c, i) => ({
      index: i, name: c.model || `GPU ${i + 1}`, vram: c.vram
    }))
  } catch { allGpus = [] }

  createMainWindow()
  createTray()
  mainWindow.once('ready-to-show', () => setTimeout(pushSystemData, 500))
  setInterval(pushSystemData, 4000)
})

app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin' && !app.isQuitting) e.preventDefault()
})

// ── Push modeli ─────────────────────────────────────────────────
async function pushSystemData() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const now = Date.now()
    const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()])

    if (!cachedNet) {
      await si.networkStats()
      await new Promise(r => setTimeout(r, 1000))
      cachedNet = await si.networkStats()
      lastNetUpdate = now
    }
    if (!cachedDisk) { cachedDisk = await si.fsSize(); lastDiskUpdate = now }
    if (!cachedProcessCount) {
      const p = await si.processes()
      cachedProcessCount = p.all
      lastProcessUpdate = now
    }
    if (!cachedGpu || now - lastGpuUpdate > 5000) {
      try {
        const gpuData = await si.graphics()
        const controller = gpuData.controllers?.[selectedGpuIndex] || gpuData.controllers?.[0]
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
      await si.networkStats()
      await new Promise(r => setTimeout(r, 1000))
      cachedNet = await si.networkStats()
      lastNetUpdate = now
    }
    if (now - lastDiskUpdate > 30000) { cachedDisk = await si.fsSize(); lastDiskUpdate = now }
    if (now - lastProcessUpdate > 15000) {
      const p = await si.processes()
      cachedProcessCount = p.all
      lastProcessUpdate = now
    }

    const time = await si.time()
    const h = Math.floor(time.uptime / 3600)
    const m = Math.floor((time.uptime % 3600) / 60)
    const lang = store.get('lang', 'tr')

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
      uptime: i18n[lang].uptime(h, m),
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
      if (!loc) return { temp: '—', desc: '—', humidity: '—', city }
      cachedCoords = { lat: loc.latitude, lon: loc.longitude, name: loc.name }
      lastCity = city
    }
    const weatherRes = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${cachedCoords.lat}&longitude=${cachedCoords.lon}&current=temperature_2m,weathercode,relative_humidity_2m&timezone=auto`
    )
    const c = weatherRes.data.current
    const lang = store.get('lang', 'tr')
    const codes = i18n[lang].weatherCodes
    return {
      temp: Math.round(c.temperature_2m),
      desc: codes[c.weathercode] || (lang === 'tr' ? 'Bilinmiyor' : 'Unknown'),
      humidity: c.relative_humidity_2m,
      city: cachedCoords.name
    }
  } catch { return { temp: '—', desc: '—', humidity: '—', city: '—' } }
})

// ── Store handlers ──────────────────────────────────────────────
ipcMain.handle('get-city', () => store.get('city', null))
ipcMain.on('set-city', (_, city) => { store.set('city', city); cachedCoords = null; lastCity = null })

ipcMain.handle('get-theme', () => store.get('theme', 'dark'))
ipcMain.on('set-theme', (_, theme) => {
  store.set('theme', theme)
  if (mainWindow) mainWindow.webContents.send('theme-changed', theme)
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.webContents.send('theme-changed', theme)
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('theme-changed', theme)
  if (benchmarkWindow && !benchmarkWindow.isDestroyed()) benchmarkWindow.webContents.send('theme-changed', theme)
})

ipcMain.handle('get-lang', () => store.get('lang', 'tr'))
ipcMain.on('set-lang', (_, lang) => {
  store.set('lang', lang)
  if (mainWindow) mainWindow.webContents.send('lang-changed', lang)
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.webContents.send('lang-changed', lang)
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('lang-changed', lang)
  updateTrayMenu(i18n[lang])
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
    store.set('baseHeight', height)
    const [currentWidth] = mainWindow.getSize()
    const zoom = currentWidth / 420
    const scaledHeight = Math.round(height * zoom)
    store.set('windowBounds', { width: currentWidth, height: scaledHeight })
    isSettingHeight = true
    mainWindow.setSize(currentWidth, scaledHeight)
    setTimeout(() => { isSettingHeight = false }, 200)
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
  if (mainWindow) { try { mainWindow.setOpacity(val) } catch (e) { } }
})

ipcMain.handle('get-gpu-list', () => allGpus)
ipcMain.handle('get-display-list', () => allDisplays)
ipcMain.handle('get-selected-gpu', () => selectedGpuIndex)
ipcMain.handle('get-selected-display', () => selectedDisplayIndex)

ipcMain.on('set-selected-gpu', (_, index) => {
  selectedGpuIndex = index
  store.set('selectedGpuIndex', index)
  cachedGpu = null
  lastGpuUpdate = 0
})

ipcMain.on('set-selected-display', (_, index) => {
  selectedDisplayIndex = index
  store.set('selectedDisplayIndex', index)
  const sel = allDisplays[index] || allDisplays[0]
  cachedDisplay = { width: sel.width, height: sel.height, hz: sel.hz }
})

function getCpuTempFallback() {
  try {
    const out = execSync(
      'powershell -command "(Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi).CurrentTemperature"',
      { timeout: 3000 }
    ).toString().trim()
    const lines = out.split('\n').map(l => l.trim()).filter(l => /^\d+$/.test(l))
    if (lines.length > 0) {
      const val = parseFloat(lines[0])
      return Math.round((val / 10) - 273.15)
    }
  } catch { }
  return null
}

ipcMain.handle('get-benchmark-sample', async () => {
  try {
    const [cpu, cpuTemp, gpu, mem] = await Promise.all([
      si.currentLoad(), si.cpuTemperature(), si.graphics(), si.mem()
    ])
    const ctrl = gpu.controllers?.[selectedGpuIndex] || gpu.controllers?.[0]
    const cpuTempVal = cpuTemp.main ?? cpuTemp.max ?? getCpuTempFallback()
    return {
      timestamp: Date.now(),
      cpu: {
        load: Math.round(cpu.currentLoad),
        temp: cpuTempVal,
        cores: cpu.cpus?.map(c => Math.round(c.load)) ?? []
      },
      gpu: {
        load: ctrl?.utilizationGpu ?? null,
        temp: ctrl?.temperatureGpu ?? null,
        vramUsed: ctrl?.memoryUsed ?? null,
        vramTotal: ctrl?.vram ?? null,
        power: ctrl?.powerDraw ?? null,
        memLoad: ctrl?.utilizationMemory ?? null
      },
      ram: {
        used: (mem.used / 1024 / 1024 / 1024).toFixed(1),
        percent: Math.round((mem.used / mem.total) * 100)
      }
    }
  } catch { return null }
})

ipcMain.on('open-editor', () => createEditorWindow())
ipcMain.on('close-editor', () => { if (editorWindow) editorWindow.close() })
ipcMain.on('open-settings', () => createSettingsWindow())
ipcMain.on('close-settings', () => { if (settingsWindow) settingsWindow.close() })
ipcMain.on('open-benchmark', () => createBenchmarkWindow())
ipcMain.on('close-benchmark', () => { if (benchmarkWindow) benchmarkWindow.close() })
ipcMain.on('hide-app', () => { if (mainWindow) mainWindow.hide() })
ipcMain.on('close-app', () => { app.isQuitting = true; app.quit() })