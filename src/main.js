const { app, BrowserWindow, ipcMain, screen } = require('electron')
const si = require('systeminformation')
const axios = require('axios')
const path = require('path')
const Store = require('electron-store')
const store = new Store()

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 900,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-theme', () => store.get('theme', 'dark'))
ipcMain.on('set-theme', (_, theme) => store.set('theme', theme))

ipcMain.handle('get-system', async () => {
  const [cpu, mem, net, disk, time, processes] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats(),
    si.fsSize(),
    si.time(),
    si.processes()
  ])

  const uptimeSec = time.uptime
  const h = Math.floor(uptimeSec / 3600)
  const m = Math.floor((uptimeSec % 3600) / 60)

  const display = (() => {
    try {
      const d = screen.getPrimaryDisplay()
      return {
        width: d.size.width,
        height: d.size.height,
        hz: Math.round(d.displayFrequency || 60)
      }
    } catch {
      return { width: '—', height: '—', hz: '—' }
    }
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
    display,
    processes: {
      all: processes.all
    },
    uptime: `${h}s ${m}dk`
  }
})

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
      humidity: c.relative_humidity_2m,
      city: loc.name
    }
  } catch {
    return { temp: '—', desc: 'Bağlanamadı', humidity: '—', city: '—' }
  }
})

ipcMain.handle('get-city', () => store.get('city', null))
ipcMain.on('set-city', (_, city) => store.set('city', city))

ipcMain.on('close-app', () => app.quit())