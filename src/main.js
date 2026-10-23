const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, session, dialog, Notification } = require('electron')
const si = require('systeminformation')
const path = require('path')
const Store = require('electron-store')
const fs = require('fs')
const os = require('os')
const store = new Store()
const i18n = require('./i18n')
const { exec } = require('child_process')

// ── Native metrics addon (optional) ─────────────────────────────
// Built from native/metrics.cc. Provides GPU stats (via NVIDIA NVML) and the
// process count without spawning nvidia-smi/tasklist. If it isn't built, isn't
// present, or fails to load (e.g. no NVIDIA driver), we silently fall back to
// systeminformation — the app works either way.
let native = null
try {
  native = require('../native/build/Release/sysmetrics.node')
  if (native && typeof native.hello === 'function') {
    console.log('[native] sysmetrics loaded:', native.hello())
  }
} catch (e) {
  native = null
  console.log('[native] sysmetrics not available, using systeminformation fallback')
}

// Native free-disk read via Node's built-in fs.statfs (no spawned process).
function readDisk() {
  try {
    const drive = (process.env.SystemDrive || 'C:') + '\\'
    const s = fs.statfsSync(drive)
    const total = s.blocks * s.bsize
    const free = s.bavail * s.bsize
    return { used: total - free, size: total, available: free }
  } catch (e) { return null }
}

// ── Native CPU load / RAM (no child processes) ──────────────────
// Task Manager reads kernel performance counters directly; systeminformation
// on Windows shells out to wmic/powershell for many metrics, which is slow and
// CPU-heavy. CPU load and RAM don't need that — we can read them straight from
// Node's built-in `os` module for effectively zero cost, and poll them often.
let lastCpuSample = null
let lastCpuLoad = 0
function readCpuLoad() {
  const cpus = os.cpus()
  let idle = 0, total = 0
  for (const c of cpus) {
    for (const k in c.times) total += c.times[k]
    idle += c.times.idle
  }
  const prev = lastCpuSample
  lastCpuSample = { idle, total }
  if (!prev) return null // need two samples to form a delta
  const idleDiff = idle - prev.idle
  const totalDiff = total - prev.total
  if (totalDiff <= 0) return null
  return Math.max(0, Math.min(100, Math.round(100 * (1 - idleDiff / totalDiff))))
}
// NVML clocks-event reasons bitmask -> the one reason worth showing. Bits that
// aren't real slowdowns (app clocks, sync boost, display clock) are ignored.
const THROTTLE_THERMAL = 0x20 | 0x40 // SW / HW thermal slowdown
const THROTTLE_POWER = 0x04 | 0x80   // SW power cap / HW power brake
const THROTTLE_HW = 0x08             // HW slowdown (thermal or power, driver doesn't say)
function decodeThrottle(mask) {
  if (mask == null) return null
  if (mask & THROTTLE_THERMAL) return 'thermal'
  if (mask & THROTTLE_POWER) return 'power'
  if (mask & THROTTLE_HW) return 'other'
  if (mask & 0x01) return 'idle'
  return 'none'
}

function readMem() {
  const total = os.totalmem()
  const used = total - os.freemem()
  return { used, total }
}

const DEFAULT_LAYOUT = [
  { id: 'card-clock', type: 'single' },
  { id: 'group-1', type: 'group', children: ['card-cpu', 'card-ram'] },
  { id: 'card-gpu', type: 'single' },
  { id: 'card-gpuproc', type: 'single' },
  { id: 'group-2', type: 'group', children: ['card-proc', 'card-screen'] },
  { id: 'card-disk', type: 'single' },
  { id: 'card-net', type: 'single' },
]

const DEFAULT_VISIBLE = [
  'card-clock', 'card-cpu', 'card-ram',
  'card-gpu', 'card-gpuproc',
  'card-proc', 'card-screen', 'card-disk',
  'card-net'
]

const VALID_CARDS = new Set([
  'card-clock', 'card-cpu', 'card-ram', 'card-gpu', 'card-gpuproc',
  'card-proc', 'card-screen', 'card-disk', 'card-net'
])

let mainWindow
let tray = null
let editorWindow
let settingsWindow
let benchmarkWindow = null

app.isQuitting = false

// Windows only shows toast notifications for apps with an AppUserModelID. The
// installer registers one; setting it here makes `npm start` builds match.
if (process.platform === 'win32') app.setAppUserModelId('com.systemdashboard.app')

// On hybrid-graphics laptops (Intel iGPU + NVIDIA dGPU) Chromium runs WebGL on
// the low-power integrated GPU by default — so the benchmark's GPU stress hit
// the Intel chip while we monitored the idle NVIDIA card. Chromium picks its GPU
// at startup and can't switch live, so this is a persisted preference read here.
// Default is the discrete GPU so the benchmark works out of the box; the
// benchmark UI lets the user flip it (takes effect on the next launch).
if (store.get('gpuHighPerf', true)) {
  app.commandLine.appendSwitch('force_high_performance_gpu')
}

// ── IPC validators ──────────────────────────────────────────────
const isStr = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max
const isEnum = (v, allowed) => allowed.includes(v)
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max
const isBool = (v) => typeof v === 'boolean'
const isLayout = (v) => Array.isArray(v) && v.length <= 50 && v.every(s =>
  s && typeof s === 'object' &&
  isStr(s.id, 60) &&
  (s.type === 'single' || (s.type === 'group' && Array.isArray(s.children) && s.children.every(c => isStr(c, 60))))
)
const isVisible = (v) => Array.isArray(v) && v.length <= 50 && v.every(c => typeof c === 'string' && VALID_CARDS.has(c))

// ── Layout repair ───────────────────────────────────────────────
// Older builds (and a since-fixed drag bug) could persist malformed slots —
// e.g. a group entry with no `children` array, an unknown card id, or the same
// card in two places. The main widget silently skips such entries, but the
// editor treated any non-'single' slot as a group and crashed on the missing
// `children` array, rendering an empty editor. Normalizing on read/write and
// repairing the store on startup guarantees every consumer gets clean data.
function normalizeLayout(v) {
  if (!Array.isArray(v)) return DEFAULT_LAYOUT.map(s => ({ ...s, children: s.children ? [...s.children] : undefined }))
  const seen = new Set()
  const out = []
  for (const slot of v) {
    if (!slot || typeof slot !== 'object') continue
    if (slot.type === 'group' && Array.isArray(slot.children)) {
      const kids = slot.children.filter(c => VALID_CARDS.has(c) && !seen.has(c))
      kids.forEach(c => seen.add(c))
      if (kids.length >= 2) {
        out.push({ id: isStr(slot.id, 60) ? slot.id : ('group-' + out.length), type: 'group', children: kids })
      } else if (kids.length === 1) {
        out.push({ id: kids[0], type: 'single' })
      }
      // 0 valid children → drop the group entirely
    } else if (VALID_CARDS.has(slot.id) && !seen.has(slot.id)) {
      seen.add(slot.id)
      out.push({ id: slot.id, type: 'single' })
    }
    // anything else (unknown id, missing type, malformed group) → drop
  }
  return out
}

// Existing installs have a saved layout without the GPU-process card. Slot it in
// under the GPU card once; if the user later hides it, that choice sticks.
function addGpuProcCardOnce() {
  if (store.get('gpuProcCardAdded')) return
  store.set('gpuProcCardAdded', true)
  const layout = store.get('layout', DEFAULT_LAYOUT)
  const has = layout.some(s => s.id === 'card-gpuproc' || (s.children || []).includes('card-gpuproc'))
  if (!has) {
    const at = layout.findIndex(s => s.id === 'card-gpu' || (s.children || []).includes('card-gpu'))
    layout.splice(at >= 0 ? at + 1 : layout.length, 0, { id: 'card-gpuproc', type: 'single' })
    store.set('layout', layout)
  }
  const vis = store.get('visibleCards', DEFAULT_VISIBLE)
  if (!vis.includes('card-gpuproc')) store.set('visibleCards', [...vis, 'card-gpuproc'])
}

// ── CSP (defense in depth alongside contextIsolation) ───────────
function applyCSP() {
  // Only enforce CSP on remote (http/https) responses. file:// origin is opaque
  // in Chromium, so 'self' would block our own bundled scripts.
  const csp = "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:;"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url || ''
    if (!/^https?:/i.test(url)) {
      // Pass through file:// and other local schemes untouched.
      return callback({ responseHeaders: details.responseHeaders })
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

// ── Per-process GPU usage & VRAM alert ─────────────────────────
// The native add-on reports every process on every adapter, keyed by the
// adapter's LUID. DXGI gives LUID <-> name, so we keep only the rows for the GPU
// shown in the widget — on a hybrid laptop the browser on the Intel iGPU must
// not be listed under the NVIDIA card.
let allAdapters = []
const GPU_PROC_ROWS = 5

function selectedAdapterLuid(gpuName) {
  if (!allAdapters.length) return null
  const want = (gpuName || allGpus[selectedGpuIndex]?.name || '').toLowerCase()
  const hit = want && allAdapters.find(a => a.name.toLowerCase() === want || a.name.toLowerCase().includes(want) || want.includes(a.name.toLowerCase()))
  if (hit) return hit.luid
  // No name to match (e.g. GPU still loading): assume the discrete card.
  return allAdapters.reduce((a, b) => (b.vram > a.vram ? b : a)).luid
}

// Returns null when per-process data isn't available at all (no add-on / no
// PDH counters) so the card can say so, vs. [] for "nothing is using the GPU".
function readGpuProcesses(gpuName) {
  if (!native || !native.gpuProcesses) return null
  let rows
  try { rows = native.gpuProcesses() } catch (e) { return null }
  if (!Array.isArray(rows)) return null
  const luid = selectedAdapterLuid(gpuName)
  // Merge multi-process apps (browsers, Electron, DataLoader workers) by exe name.
  const byName = new Map()
  for (const r of rows) {
    if (luid && r.luid !== luid) continue
    const name = r.name || ('pid ' + r.pid)
    const cur = byName.get(name) || { name, mem: 0, load: 0, count: 0 }
    cur.mem += r.mem
    cur.load += r.load
    cur.count++
    byName.set(name, cur)
  }
  return [...byName.values()]
    .map(p => ({ name: p.name, mem: Math.round(p.mem), load: Math.min(100, Math.round(p.load)), count: p.count }))
    .sort((a, b) => (b.mem - a.mem) || (b.load - a.load))
    .slice(0, GPU_PROC_ROWS)
}

// Hysteresis so a value hovering around the line doesn't spam notifications:
// fire at >= 90 %, re-arm only after dropping below 85 %.
const VRAM_ALERT_ON = 90
const VRAM_ALERT_OFF = 85
let vramAlertActive = false

function vramPercent(gpu) {
  if (!gpu || gpu.vramUsed == null || !gpu.vram) return null
  return Math.round((gpu.vramUsed / gpu.vram) * 100)
}

function checkVramAlert(gpu, procs) {
  const pct = vramPercent(gpu)
  if (pct === null) return false
  if (!vramAlertActive && pct >= VRAM_ALERT_ON) {
    vramAlertActive = true
    console.log('[vram-alert] ' + pct + '% (' + gpu.vramUsed + ' / ' + gpu.vram + ' MB)')
    if (Notification.isSupported()) {
      const t = i18n[store.get('lang', 'tr')]
      const top = (procs || readGpuProcesses(gpu.name) || [])[0]
      new Notification({
        title: t.vramAlertTitle,
        body: t.vramAlertBody(pct, gpu.vramUsed, gpu.vram, top ? top.name + ' (' + top.mem + ' MB)' : null),
        icon: path.join(__dirname, '../assets/icon.png')
      }).show()
    }
  } else if (vramAlertActive && pct < VRAM_ALERT_OFF) {
    vramAlertActive = false
  }
  return vramAlertActive
}

// While the widget sits hidden in the tray the full poll is skipped, but a long
// training run is exactly when nobody is watching — so keep this one NVML read
// (no spawned process) going to still warn before an out-of-memory crash.
function hiddenVramWatch() {
  if (!native || !native.gpu) return
  try {
    const g = native.gpu(selectedGpuIndex)
    if (g && g.memUsed != null && g.memTotal) {
      checkVramAlert({ name: g.name, vramUsed: Math.round(g.memUsed), vram: g.memTotal }, null)
    }
  } catch (e) { /* ignore */ }
}

// ── SystemPoller — central cache for periodic system data ──────
class SystemPoller {
  constructor() {
    this.display = null
    this.disk = null
    this.net = null
    this.processCount = 0
    this.gpu = null
    this.cpuTemp = null
    this.cpuTempFallback = null      // last value from the WMI fallback (Windows)
    this.lastDisk = 0
    this.lastNet = 0
    this.lastProcess = 0
    this.lastGpu = 0
    this.lastTemp = 0
    this.lastTempFallbackAt = 0
    this.tempFallbackTries = 0       // consecutive empty WMI reads
    this.tempFallbackDisabled = false // give up after repeated failures (no sensor)
    this.tempSiMisses = 0            // consecutive empty si.cpuTemperature() reads
    this.lastNetSample = null        // { rx, tx, at } from the native counters
    this.inFlight = new Set()        // slow background probes currently running
    this.gpuProcs = []               // top GPU consumers on the selected adapter
  }

  // Run a slow probe without blocking the tick. The fast metrics (CPU, RAM, GPU)
  // must never wait on systeminformation: on Windows it shells out to PowerShell,
  // and e.g. the first networkStats() call measured ~18s, which left the whole
  // widget blank for that long and stalled every update behind it.
  background(key, fn) {
    if (this.inFlight.has(key)) return
    this.inFlight.add(key)
    Promise.resolve().then(fn).catch(() => {}).finally(() => this.inFlight.delete(key))
  }

  invalidateGpu() {
    this.gpu = null
    this.lastGpu = 0
  }

  async refresh(now) {
    // Network: native interface counters (instant) turned into a rate per tick.
    const nb = native && native.netBytes ? (() => { try { return native.netBytes() } catch (e) { return null } })() : null
    if (nb) {
      const prev = this.lastNetSample
      this.lastNetSample = { rx: nb.rx, tx: nb.tx, at: now }
      if (prev && now > prev.at) {
        const sec = (now - prev.at) / 1000
        this.net = [{ rx_sec: Math.max(0, nb.rx - prev.rx) / sec, tx_sec: Math.max(0, nb.tx - prev.tx) / sec }]
      }
    } else if (now - this.lastNet > 15000) {
      this.lastNet = now
      this.background('net', async () => { this.net = await si.networkStats() })
    }

    if (!this.disk || now - this.lastDisk > 60000) {
      const d = readDisk() // native fs.statfs, no spawned process
      if (d) { this.disk = [d]; this.lastDisk = now }
      else { try { this.disk = await si.fsSize(); this.lastDisk = now } catch (e) {} }
    }

    // Process count: native EnumProcesses (instant) or fall back to tasklist.
    if (native && native.processCount) {
      try { const c = native.processCount(); if (c >= 0) { this.processCount = c; this.lastProcess = now } } catch (e) {}
    } else if (!this.processCount || now - this.lastProcess > 60000) {
      try { const p = await si.processes(); this.processCount = p.all; this.lastProcess = now } catch (e) {}
    }

    // GPU: prefer the native NVML reader (instant, no nvidia-smi spawn). It's
    // cheap enough to read every tick. Falls back to systeminformation (throttled)
    // when the addon or an NVIDIA GPU isn't available.
    let gpuHandled = false
    if (native && native.gpu) {
      try {
        const g = native.gpu(selectedGpuIndex)
        if (g) {
          // NVML gives everything; the PDH fallback (AMD/Intel) gives only load +
          // VRAM used, so fill name/VRAM-total from the enumerated GPU list.
          const listed = allGpus[selectedGpuIndex] || allGpus[0] || {}
          const total = g.memTotal ?? listed.vram ?? null
          const used = g.memUsed != null ? Math.round(g.memUsed) : null
          this.gpu = {
            name: g.name ?? listed.name ?? '—',
            vram: total,
            vramUsed: used,
            vramFree: (total != null && used != null) ? (total - used) : null,
            load: g.load != null ? Math.round(g.load) : null,
            memLoad: g.memLoad != null ? Math.round(g.memLoad) : null,
            temp: g.temp ?? null,
            power: g.power ?? null,
            clockCore: g.clockCore ?? null,
            fan: g.fan ?? null,
            throttle: decodeThrottle(g.throttle),
            vendor: g.name ? 'NVIDIA' : ''
          }
          this.lastGpu = now
          gpuHandled = true
        }
      } catch (e) { /* fall through to si */ }
    }
    if (!gpuHandled && (!this.gpu || now - this.lastGpu > 20000)) {
      this.lastGpu = now
      this.background('gpu', async () => {
        const gpuData = await si.graphics()
        const controller = gpuData.controllers?.[selectedGpuIndex] || gpuData.controllers?.[0]
        this.gpu = {
          name: controller?.model ?? '—',
          vram: controller?.vram ?? null,
          vramUsed: controller?.memoryUsed ?? null,
          vramFree: controller?.memoryFree ?? null,
          load: controller?.utilizationGpu ?? null,
          memLoad: controller?.utilizationMemory ?? null,
          temp: controller?.temperatureGpu ?? null,
          power: controller?.powerDraw ?? null,
          clockCore: controller?.clockCore ?? null,
          fan: controller?.fanSpeed ?? null,
          throttle: null,
          vendor: controller?.vendor ?? ''
        }
      })
    }

    this.gpuProcs = readGpuProcesses(this.gpu?.name)

    // CPU temperature. Most Windows machines expose no sensor to user-mode code,
    // so after 3 empty reads we stop asking systeminformation (each call spawns
    // PowerShell, ~2.5s here) instead of paying that every 20s forever.
    if (now - this.lastTemp > 20000 && this.tempSiMisses < 3) {
      this.lastTemp = now
      this.background('temp', async () => {
        const t = await si.cpuTemperature()
        const v = t.main ?? t.max ?? null
        if (v === null) this.tempSiMisses++
        else this.tempSiMisses = 0
        this.cpuTemp = v ?? this.cpuTempFallback ?? null
      })
      // On Windows `systeminformation` frequently can't read CPU temperature.
      // When it comes back empty, refresh a WMI reading in the background — kept
      // non-blocking (no execSync on the main thread) and throttled to 60s. Each
      // call spawns a PowerShell process, so if the machine simply has no thermal
      // sensor we STOP after 3 empty reads instead of spawning forever.
      if (process.platform === 'win32' && this.cpuTemp === null &&
          !this.tempFallbackDisabled && now - this.lastTempFallbackAt > 60000) {
        this.lastTempFallbackAt = now
        getCpuTempFallbackAsync().then(v => {
          if (v !== null) { this.cpuTempFallback = v; this.cpuTemp = v; this.tempFallbackTries = 0 }
          else if (++this.tempFallbackTries >= 3) { this.tempFallbackDisabled = true }
        }).catch(() => {})
      }
    }
  }
}

const poller = new SystemPoller()

// ── Cache for non-poller state ──────────────────────────────────
let cachedDisplay = null
let repositionTimer = null
let isSettingHeight = false
let selectedGpuIndex = store.get('selectedGpuIndex', 0)
let selectedDisplayIndex = store.get('selectedDisplayIndex', 0)
let allGpus = []
let allDisplays = []

// ── Pencereler ──────────────────────────────────────────────────
function commonWebPrefs() {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false,
    preload: path.join(__dirname, 'preload.js')
  }
}

// Forward a child window's console + load errors to the terminal running the
// app, so renderer-side problems (e.g. the editor coming up blank) are visible.
function attachDiagnostics(win, tag) {
  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    console.log('[' + tag + ':' + level + '] ' + src + ':' + line + ' ' + msg)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[' + tag + ' did-fail-load]', code, desc, url)
  })
  win.webContents.on('preload-error', (_e, file, err) => {
    console.error('[' + tag + ' preload-error]', file, err && err.message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[' + tag + ' render-process-gone]', details)
  })
}

function createMainWindow() {
  const bounds = store.get('windowBounds', { width: 420, height: 860 })
  const alwaysOnTop = store.get('alwaysOnTop', true)
  mainWindow = new BrowserWindow({
    width: bounds.width, height: bounds.height,
    minWidth: 300, maxWidth: 700,
    resizable: true, frame: false, alwaysOnTop,
    webPreferences: commonWebPrefs()
  })
  if (alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'screen-saver')
  // Diagnostic listeners — surface load errors and renderer console messages
  // (these are silent helpers; they don't open DevTools by default).
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details)
  })
  mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
    console.log('[renderer:' + level + ']', src + ':' + line, msg)
  })
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

  // Polling pauses while hidden (see pushSystemData). Refresh immediately on show
  // so re-opening from the tray shows current values instead of a stale snapshot.
  mainWindow.on('show', () => setTimeout(pushSystemData, 0))

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
    if (settingsWindow && !settingsWindow.isDestroyed()) windows.push({ win: settingsWindow, w: 300, h: SETTINGS_HEIGHT })
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
    webPreferences: commonWebPrefs()
  })
  attachDiagnostics(editorWindow, 'editor')
  editorWindow.loadFile(path.join(__dirname, 'editor.html'))
  editorWindow.on('closed', () => { editorWindow = null; repositionChildWindows() })
}

const SETTINGS_HEIGHT = 480

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return }
  const { x, y } = mainWindow.getBounds()
  const [mainWidth] = mainWindow.getSize()
  const gap = 8
  settingsWindow = new BrowserWindow({
    width: 300, height: SETTINGS_HEIGHT,
    x: x + mainWidth + gap, y,
    resizable: false, frame: false, alwaysOnTop: true,
    webPreferences: commonWebPrefs()
  })
  attachDiagnostics(settingsWindow, 'settings')
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))
  settingsWindow.on('closed', () => { settingsWindow = null; repositionChildWindows() })
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.setPosition(x + mainWidth + gap, y + SETTINGS_HEIGHT + gap)
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
    webPreferences: commonWebPrefs()
  })
  attachDiagnostics(benchmarkWindow, 'benchmark')
  benchmarkWindow.loadFile(path.join(__dirname, 'benchmark.html'))
  benchmarkWindow.on('closed', () => { benchmarkWindow = null; repositionChildWindows() })
}

app.whenReady().then(async () => {
  applyCSP()

  // Repair any malformed layout persisted by older builds so the editor can't
  // render blank. Also drop any stored visible-card ids that are no longer valid.
  try {
    const repaired = normalizeLayout(store.get('layout', DEFAULT_LAYOUT))
    store.set('layout', repaired.length ? repaired : DEFAULT_LAYOUT)
    const vis = store.get('visibleCards', DEFAULT_VISIBLE)
    if (Array.isArray(vis)) store.set('visibleCards', vis.filter(c => VALID_CARDS.has(c)))
    addGpuProcCardOnce()
  } catch (e) { /* keep going with defaults */ }

  if (native && native.adapters) {
    try { allAdapters = native.adapters() || [] } catch (e) { allAdapters = [] }
  }

  try {
    const displays = screen.getAllDisplays()
    allDisplays = displays.map((d, i) => ({
      index: i,
      name: 'Display ' + (i + 1) + ' (' + d.size.width + 'x' + d.size.height + ')',
      width: d.size.width, height: d.size.height,
      hz: Math.round(d.displayFrequency || 60)
    }))
    const sel = allDisplays[selectedDisplayIndex] || allDisplays[0]
    cachedDisplay = { width: sel.width, height: sel.height, hz: sel.hz }
  } catch { cachedDisplay = { width: '—', height: '—', hz: '—' } }

  // Show the UI immediately. Do NOT block window creation on systeminformation:
  // on Windows si.graphics() shells out to nvidia-smi / wmic and can take many
  // seconds, which is what made startup take ~a minute. The window renders its
  // shell right away and data streams in as it becomes available.
  createMainWindow()
  createTray()
  readCpuLoad() // prime the CPU delta baseline so the first push has a real value
  mainWindow.once('ready-to-show', () => setTimeout(pushSystemData, 300))
  pushLoop()

  // Enumerate GPUs for the dropdown. Native NVML first (instant); otherwise fall
  // back to systeminformation in the background.
  let nativeListed = false
  if (native && native.gpuList) {
    try {
      const list = native.gpuList()
      if (list && list.length) {
        allGpus = list.map(g => ({ index: g.index, name: g.name || ('GPU ' + (g.index + 1)), vram: null }))
        nativeListed = true
      }
    } catch (e) { /* fall back */ }
  }
  if (!nativeListed) {
    si.graphics().then(gpuData => {
      allGpus = (gpuData.controllers || []).map((c, i) => ({
        index: i, name: c.model || ('GPU ' + (i + 1)), vram: c.vram
      }))
    }).catch(() => { allGpus = [] })
  }
})

app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin' && !app.isQuitting) e.preventDefault()
})

// ── Push modeli ─────────────────────────────────────────────────
// Refresh rate is user-selectable. Every per-tick source (os CPU/RAM, NVML GPU,
// EnumProcesses) is effectively free, so 1s is fine for watching a game; the
// expensive probes (network, temperature, disk) keep their own throttles.
const REFRESH_OPTIONS = [1000, 2000, 5000]
let pushInterval = REFRESH_OPTIONS.includes(store.get('refreshMs')) ? store.get('refreshMs') : 2000
let pushTimer = null
let isPushing = false

// Self-scheduling loop instead of setInterval: the next tick is scheduled only
// AFTER the current one finishes. setInterval fires every 4s regardless of
// whether the previous push completed, so on a slow machine the systeminformation
// calls piled up, spawned overlapping wmic/nvidia-smi/tasklist processes, pegged
// the CPU and froze the UI — which is why the close buttons stopped responding.
async function pushLoop() {
  try { await pushSystemData() } catch (e) { /* never let the loop die */ }
  pushTimer = setTimeout(pushLoop, pushInterval)
}

async function pushSystemData() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (isPushing) return // guard against overlapping runs (belt-and-suspenders)
  // While hidden in the tray there is nothing on screen to update, so skip all
  // the systeminformation calls entirely. On Windows several of them spawn
  // external processes (wmic / tasklist / powershell); doing that every 4s for a
  // widget nobody is looking at was the main source of idle CPU load.
  if (!mainWindow.isVisible()) { hiddenVramWatch(); return }
  isPushing = true
  try {
    const now = Date.now()
    // CPU load, RAM and uptime come straight from the OS — no spawned processes.
    const cpuLoad = readCpuLoad()
    if (cpuLoad !== null) lastCpuLoad = cpuLoad
    const mem = readMem()

    await poller.refresh(now)

    const uptimeSec = os.uptime()
    const h = Math.floor(uptimeSec / 3600)
    const m = Math.floor((uptimeSec % 3600) / 60)
    const lang = store.get('lang', 'tr')

    mainWindow.webContents.send('system-update', {
      cpu: lastCpuLoad,
      cpuTemp: poller.cpuTemp,
      ram: {
        used: (mem.used / 1024 / 1024 / 1024).toFixed(1),
        total: (mem.total / 1024 / 1024 / 1024).toFixed(1),
        percent: Math.round((mem.used / mem.total) * 100)
      },
      net: {
        download: poller.net?.[0] ? (poller.net[0].rx_sec / 1024 / 1024).toFixed(1) : '0.0',
        upload: poller.net?.[0] ? (poller.net[0].tx_sec / 1024 / 1024).toFixed(1) : '0.0'
      },
      disk: {
        percent: poller.disk?.[0] ? Math.round((poller.disk[0].used / poller.disk[0].size) * 100) : 0,
        free: poller.disk?.[0] ? (poller.disk[0].available / 1024 / 1024 / 1024).toFixed(1) : '—'
      },
      display: cachedDisplay,
      processes: { all: poller.processCount },
      uptime: i18n[lang].uptime(h, m),
      gpu: poller.gpu ? { ...poller.gpu, vramAlert: checkVramAlert(poller.gpu, poller.gpuProcs) } : null,
      gpuProcs: poller.gpuProcs
    })
  } catch (e) { /* swallow */ } finally {
    isPushing = false
  }
}

// ── Store handlers ──────────────────────────────────────────────
ipcMain.handle('get-theme', () => store.get('theme', 'dark'))
ipcMain.on('set-theme', (_, theme) => {
  if (!isEnum(theme, ['dark', 'light'])) { console.warn('[ipc] reject set-theme'); return }
  store.set('theme', theme)
  if (mainWindow) mainWindow.webContents.send('theme-changed', theme)
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.webContents.send('theme-changed', theme)
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('theme-changed', theme)
  if (benchmarkWindow && !benchmarkWindow.isDestroyed()) benchmarkWindow.webContents.send('theme-changed', theme)
})

ipcMain.handle('get-lang', () => store.get('lang', 'tr'))
ipcMain.on('set-lang', (_, lang) => {
  if (!isEnum(lang, ['tr', 'en'])) { console.warn('[ipc] reject set-lang'); return }
  store.set('lang', lang)
  if (mainWindow) mainWindow.webContents.send('lang-changed', lang)
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.webContents.send('lang-changed', lang)
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('lang-changed', lang)
  updateTrayMenu(i18n[lang])
})

ipcMain.handle('get-layout', () => normalizeLayout(store.get('layout', DEFAULT_LAYOUT)))
ipcMain.on('set-layout', (_, layout) => {
  if (!isLayout(layout)) { console.warn('[ipc] reject set-layout'); return }
  const clean = normalizeLayout(layout)
  store.set('layout', clean)
  if (mainWindow) mainWindow.webContents.send('layout-updated', clean)
})

ipcMain.handle('get-visible', () => store.get('visibleCards', DEFAULT_VISIBLE))
ipcMain.on('set-visible', (_, visible) => {
  if (!isVisible(visible)) { console.warn('[ipc] reject set-visible'); return }
  store.set('visibleCards', visible)
  if (mainWindow) mainWindow.webContents.send('visible-updated', visible)
})

ipcMain.on('set-window-height', (_, height) => {
  if (!isInt(height, 100, 4000)) { console.warn('[ipc] reject set-window-height'); return }
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
  if (!isBool(val)) { console.warn('[ipc] reject set-always-on-top'); return }
  store.set('alwaysOnTop', val)
  if (mainWindow) {
    if (val) mainWindow.setAlwaysOnTop(true, 'screen-saver')
    else mainWindow.setAlwaysOnTop(false)
  }
})

ipcMain.handle('get-opacity', () => store.get('opacity', 1))
ipcMain.on('set-opacity', (_, val) => {
  if (!isNum(val, 0.1, 1)) { console.warn('[ipc] reject set-opacity'); return }
  store.set('opacity', val)
  if (mainWindow) { try { mainWindow.setOpacity(val) } catch (e) { } }
})

ipcMain.handle('get-refresh-rate', () => pushInterval)
ipcMain.on('set-refresh-rate', (_, ms) => {
  if (!REFRESH_OPTIONS.includes(ms)) { console.warn('[ipc] reject set-refresh-rate'); return }
  pushInterval = ms
  store.set('refreshMs', ms)
  // Restart the loop so the new rate applies now instead of after the old delay.
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushLoop, 0)
})

ipcMain.handle('get-gpu-highperf', () => store.get('gpuHighPerf', true))
ipcMain.on('set-gpu-highperf', (_, val) => {
  if (!isBool(val)) { console.warn('[ipc] reject set-gpu-highperf'); return }
  store.set('gpuHighPerf', val) // applied at next startup
})

ipcMain.handle('get-gpu-list', () => allGpus)
ipcMain.handle('get-display-list', () => allDisplays)
ipcMain.handle('get-selected-gpu', () => selectedGpuIndex)
ipcMain.handle('get-selected-display', () => selectedDisplayIndex)

ipcMain.on('set-selected-gpu', (_, index) => {
  if (!isInt(index, 0, 31)) { console.warn('[ipc] reject set-selected-gpu'); return }
  selectedGpuIndex = index
  store.set('selectedGpuIndex', index)
  poller.invalidateGpu()
})

ipcMain.on('set-selected-display', (_, index) => {
  if (!isInt(index, 0, 31)) { console.warn('[ipc] reject set-selected-display'); return }
  selectedDisplayIndex = index
  store.set('selectedDisplayIndex', index)
  const sel = allDisplays[index] || allDisplays[0]
  if (sel) cachedDisplay = { width: sel.width, height: sel.height, hz: sel.hz }
})

function parseThermalZoneOutput(out) {
  const lines = out.split('\n').map(l => l.trim()).filter(l => /^\d+$/.test(l))
  if (lines.length > 0) {
    const val = parseFloat(lines[0])
    // WMI reports tenths of a Kelvin.
    return Math.round((val / 10) - 273.15)
  }
  return null
}

const WMI_TEMP_CMD =
  'powershell -command "(Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi).CurrentTemperature"'

// Async, non-blocking read — used by the poller so the widget never freezes.
function getCpuTempFallbackAsync() {
  return new Promise((resolve) => {
    exec(WMI_TEMP_CMD, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      try { resolve(parseThermalZoneOutput(stdout.toString().trim())) } catch { resolve(null) }
    })
  })
}

ipcMain.handle('get-benchmark-sample', async () => {
  try {
    // CPU load + temperature. si.currentLoad() keeps its own sampling state, so
    // it stays accurate independent of the widget's readCpuLoad(). Temperature
    // comes from the poller's cache: si.cpuTemperature() spawns PowerShell on
    // Windows (~2.5s), longer than the sample interval itself.
    let cpuLoad = null
    const cpuTempVal = poller.cpuTemp ?? poller.cpuTempFallback ?? null
    try {
      cpuLoad = Math.round((await si.currentLoad()).currentLoad)
    } catch (e) { /* leave null */ }

    // GPU — native NVML first (real load/temp/power/VRAM, no nvidia-smi spawn),
    // which matters most during a stress test. Fall back to systeminformation.
    let gpu = { load: null, temp: null, vramUsed: null, vramTotal: null, power: null, memLoad: null }
    if (native && native.gpu) {
      try {
        const g = native.gpu(selectedGpuIndex)
        if (g) gpu = {
          load: g.load ?? null, temp: g.temp ?? null,
          vramUsed: g.memUsed ?? null, vramTotal: g.memTotal ?? null,
          power: g.power ?? null, memLoad: g.memLoad ?? null,
          clockCore: g.clockCore ?? null, throttle: decodeThrottle(g.throttle)
        }
      } catch (e) { /* fall through */ }
    }
    if (gpu.load === null && gpu.temp === null) {
      try {
        const gd = await si.graphics()
        const ctrl = gd.controllers?.[selectedGpuIndex] || gd.controllers?.[0]
        gpu = {
          load: ctrl?.utilizationGpu ?? null, temp: ctrl?.temperatureGpu ?? null,
          vramUsed: ctrl?.memoryUsed ?? null, vramTotal: ctrl?.vram ?? null,
          power: ctrl?.powerDraw ?? null, memLoad: ctrl?.utilizationMemory ?? null
        }
      } catch (e) { /* leave nulls */ }
    }

    const mem = readMem()
    return {
      timestamp: Date.now(),
      cpu: { load: cpuLoad, temp: cpuTempVal },
      gpu,
      ram: {
        used: (mem.used / 1024 / 1024 / 1024).toFixed(1),
        percent: Math.round((mem.used / mem.total) * 100)
      }
    }
  } catch { return null }
})

ipcMain.handle('save-benchmark-report', async (event, payload) => {
  try {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid' }
    const content = typeof payload.content === 'string' ? payload.content : ''
    const suggested = isStr(payload.filename, 200) ? payload.filename : 'benchmark.json'
    const win = BrowserWindow.fromWebContents(event.sender)
    // Reports are serialized as JSON (see benchmark.js), so offer JSON first.
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggested,
      filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'Text', extensions: ['txt'] }, { name: 'All', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    fs.writeFileSync(result.filePath, content, 'utf8')
    return { ok: true, path: result.filePath }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
})

// close() can be swallowed if a renderer is mid-teardown; destroy() as a fallback
// guarantees the window actually goes away.
const closeWindow = (win) => {
  if (!win || win.isDestroyed()) return
  try { win.close() } catch (e) {}
  setTimeout(() => { if (win && !win.isDestroyed()) { try { win.destroy() } catch (e) {} } }, 300)
}

ipcMain.on('open-editor', () => createEditorWindow())
ipcMain.on('close-editor', () => closeWindow(editorWindow))
ipcMain.on('open-settings', () => createSettingsWindow())
ipcMain.on('close-settings', () => closeWindow(settingsWindow))
ipcMain.on('open-benchmark', () => createBenchmarkWindow())
ipcMain.on('close-benchmark', () => closeWindow(benchmarkWindow))
ipcMain.on('hide-app', () => { if (mainWindow) mainWindow.hide() })
ipcMain.on('close-app', () => { app.isQuitting = true; app.quit() })