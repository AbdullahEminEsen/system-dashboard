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

function createMainWindow() {
  const height = store.get('windowHeight', 860)
  mainWindow = new BrowserWindow({
    width: 420, height,
    resizable: false, frame: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
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

app.whenReady().then(createMainWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Sistem
ipcMain.handle('get-system', async () => {
  const [cpu, mem, net, disk, time, processes] = await Promise.all([
    si.currentLoad(), si.mem(), si.networkStats(),
    si.fsSize(), si.time(), si.processes()
  ])
  const uptimeSec = time.uptime
  const h = Math.floor(uptimeSec / 3600)
  const m = Math.floor((uptimeSec % 3600) / 60)
  const display = (() => {
    try {
      const d = screen.getPrimaryDisplay()
      return { width: d.size.width, height: d.size.height, hz: Math.round(d.displayFrequency || 60) }
    } catch { return { width: '—', height: '—', hz: '—' } }
  })()
  return {
    cpu: Math.round(cpu.currentLoad),
    ram: {
      used: (mem.used / 1024 / 1024 / 1024).toFixed(1),
      total: (mem.total / 1024 / 1024 / 1024).toFixed(1),
      percent: Math.round((mem.used / mem.total) * 100)
    },
    net: {
      download: net[0] ? (net[0].rx_sec / 1024 / 1024).toFixed(1) : '0.0',
      upload: net[0] ? (net[0].tx_sec / 1024 / 1024).toFixed(1) : '0.0'
    },
    disk: {
      percent: disk[0] ? Math.round((disk[0].used / disk[0].size) * 100) : 0,
      free: disk[0] ? (disk[0].available / 1024 / 1024 / 1024).toFixed(1) : '—'
    },
    display, processes: { all: processes.all },
    uptime: `${h}s ${m}dk`
  }
})

// Hava durumu
ipcMain.handle('get-weather', async () => {
  try {
    const city = store.get('city', null)
    if (!city) return { temp: '—', desc: '—', humidity: '—', city: '—' }
    const geoRes = await axios.get(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr`
    )
    const loc = geoRes.data.results?.[0]
    if (!loc) return { temp: '—', desc: 'Şehir bulunamadı', humidity: '—', city }
    const weatherRes = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weathercode,relative_humidity_2m&timezone=auto`
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
      humidity: c.relative_humidity_2m, city: loc.name
    }
  } catch { return { temp: '—', desc: 'Bağlanamadı', humidity: '—', city: '—' } }
})

// Store handlers
ipcMain.handle('get-city', () => store.get('city', null))
ipcMain.on('set-city', (_, city) => store.set('city', city))
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
  if (mainWindow) mainWindow.setSize(420, height)
})
ipcMain.on('open-editor', () => createEditorWindow())
ipcMain.on('close-editor', () => { if (editorWindow) editorWindow.close() })
ipcMain.on('close-app', () => app.quit())