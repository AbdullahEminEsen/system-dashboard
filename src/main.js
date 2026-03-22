const { app, BrowserWindow, ipcMain, screen } = require('electron')
const si = require('systeminformation')
const axios = require('axios')
const path = require('path')
const Store = require('electron-store')
const store = new Store()

const DEFAULT_LAYOUT = [
  { id: 'card-clock',   type: 'single' },
  { id: 'group-1',      type: 'group', children: ['card-cpu', 'card-ram'] },
  { id: 'group-2',      type: 'group', children: ['card-proc', 'card-screen'] },
  { id: 'card-disk',    type: 'single' },
  { id: 'card-net',     type: 'single' },
  { id: 'card-weather', type: 'single' },
]

const DEFAULT_VISIBLE = [
  'card-clock', 'card-cpu', 'card-ram',
  'card-proc', 'card-screen', 'card-disk',
  'card-net', 'card-weather'
]

let mainWindow
let editorWindow

// ── Cache değişkenleri ──────────────────────────────────────────
let cachedDisplay = null
let cachedDisk = null
let lastDiskUpdate = 0
let cachedNet = null
let lastNetUpdate = 0
let cachedProcessCount = 0
let lastProcessUpdate = 0
let cachedCoords = null
let lastCity = null

// ── Pencere oluşturma ───────────────────────────────────────────
function createMainWindow() {
  const height = store.get('windowHeight', 860)
  const alwaysOnTop = store.get('alwaysOnTop', true)
  mainWindow = new BrowserWindow({
    width: 420, height,
    resizable: false, frame: false,
    alwaysOnTop,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  if (alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setOpacity(store.get('opacity', 1))
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.on('closed', () => {
    if (editorWindow) editorWindow.close()
  })
}

function createEditorWindow() {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus()
    return
  }
  const { x, y } = mainWindow.getBounds()
  editorWindow = new BrowserWindow({
    width: 340, height: 560,
    x: x + 430, y,
    resizable: false, frame: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  editorWindow.loadFile(path.join(__dirname, 'editor.html'))
  editorWindow.on('closed', () => { editorWindow = null })
}

app.whenReady().then(() => {
  // Ekran bilgisini sadece bir kez al
  try {
    const d = screen.getPrimaryDisplay()
    cachedDisplay = {
      width: d.size.width,
      height: d.size.height,
      hz: Math.round(d.displayFrequency || 60)
    }
  } catch {
    cachedDisplay = { width: '—', height: '—', hz: '—' }
  }

  createMainWindow()

  // Push modeli — main process veriyi hazırlayıp renderer'a gönderir
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

    // Hafif — her 4 sn
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem()
    ])

    // Orta — her 10 sn
    if (now - lastNetUpdate > 10000) {
      cachedNet = await si.networkStats()
      lastNetUpdate = now
    }

    // Ağır — her 30 sn
    if (now - lastDiskUpdate > 30000) {
      cachedDisk = await si.fsSize()
      lastDiskUpdate = now
    }

    // Process — her 15 sn
    if (now - lastProcessUpdate > 15000) {
      const p = await si.processes()
      cachedProcessCount = p.all
      lastProcessUpdate = now
    }

    // Uptime
    const time = await si.time()
    const h = Math.floor(time.uptime / 3600)
    const m = Math.floor((time.uptime % 3600) / 60)

    const data = {
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
      uptime: `${h}s ${m}dk`
    }

    mainWindow.webContents.send('system-update', data)
  } catch (e) {}
}

// ── Hava durumu ─────────────────────────────────────────────────
ipcMain.handle('get-weather', async () => {
  try {
    const city = store.get('city', null)
    if (!city) return { temp: '—', desc: '—', humidity: '—', city: '—' }

    // City değişmediyse geocoding yapma
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
  // Şehir değişince koordinat cache'ini sıfırla
  cachedCoords = null
  lastCity = null
})

ipcMain.handle('get-theme', () => store.get('theme', 'dark'))
ipcMain.on('set-theme', (_, theme) => {
  store.set('theme', theme)
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.webContents.send('theme-changed', theme)
  }
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
  store.set('windowHeight', height)
  if (mainWindow) mainWindow.setContentSize(420, height)
})

ipcMain.handle('get-always-on-top', () => store.get('alwaysOnTop', true))
ipcMain.on('set-always-on-top', (_, val) => {
  store.set('alwaysOnTop', val)
  if (mainWindow) {
    if (val) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
    } else {
      mainWindow.setAlwaysOnTop(false)
    }
  }
})

ipcMain.handle('get-opacity', () => store.get('opacity', 1))
ipcMain.on('set-opacity', (_, val) => {
  store.set('opacity', val)
  if (mainWindow) mainWindow.setOpacity(val)
})

ipcMain.on('open-editor', () => createEditorWindow())
ipcMain.on('close-editor', () => { if (editorWindow) editorWindow.close() })
ipcMain.on('close-app', () => app.quit())