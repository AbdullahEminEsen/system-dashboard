const { ipcRenderer } = require('electron')

// ── Sabit yükseklikler ──────────────────────────────────────────
const CARD_HEIGHTS = {
  'card-clock':   95,
  'card-cpu':     90,
  'card-ram':     100,
  'card-proc':    85,
  'card-screen':  80,
  'card-disk':    100,
  'card-net':     90,
  'card-weather': 135,
}
const GAP = 10
const PADDING = 28
const TITLEBAR = 48

function calcHeight(layout, visible) {
  let total = TITLEBAR + PADDING
  let itemCount = 0

  layout.forEach(item => {
    if (item.type === 'single') {
      if (!visible.includes(item.id)) return
      const el = document.getElementById(item.id)
      total += el ? el.offsetHeight : (CARD_HEIGHTS[item.id] || 90)
      itemCount++
    } else if (item.type === 'group') {
      const vis = item.children.filter(c => visible.includes(c))
      if (vis.length === 0) return
      if (vis.length === 1) {
        const el = document.getElementById(vis[0])
        total += el ? el.offsetHeight : (CARD_HEIGHTS[vis[0]] || 90)
      } else {
        const groupEl = document.getElementById(item.id)
        total += groupEl ? groupEl.offsetHeight : Math.max(...vis.map(c => CARD_HEIGHTS[c] || 90))
      }
      itemCount++
    }
  })

  total += Math.max(0, itemCount - 1) * GAP
  return Math.max(150, total)
}

let currentLayout = []
let currentVisible = []

// ── Kart şablonları ─────────────────────────────────────────────
const CARD_TEMPLATES = {
  'card-clock': () => `
    <div class="card" id="card-clock">
      <div class="card-header">
        <i data-lucide="clock-3" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">Saat</span>
      </div>
      <div class="clock-value" id="clock">--:--:--</div>
      <div class="sub" id="dateStr">—</div>
    </div>`,

  'card-cpu': () => `
    <div class="card" id="card-cpu">
      <div class="card-header">
        <i data-lucide="cpu" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">CPU</span>
      </div>
      <div class="value" id="cpuVal" style="color:#60a5fa">—<span class="unit">%</span></div>
      <div class="bar-bg"><div class="bar" id="cpuBar" style="background:#3b82f6;width:0%"></div></div>
    </div>`,

  'card-ram': () => `
    <div class="card" id="card-ram">
      <div class="card-header">
        <i data-lucide="memory-stick" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">RAM</span>
      </div>
      <div class="value" id="ramVal" style="color:#a78bfa">—<span class="unit">GB</span></div>
      <div class="bar-bg"><div class="bar" id="ramBar" style="background:#8b5cf6;width:0%"></div></div>
      <div class="sub" id="ramSub">— / — GB</div>
    </div>`,

  'card-proc': () => `
    <div class="card" id="card-proc">
      <div class="card-header">
        <i data-lucide="layers" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">İşlemler</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-top:4px">
        <div style="font-size:32px;font-weight:600;color:#60a5fa;line-height:1" id="procAll">—</div>
        <div style="font-size:12px;color:var(--text-muted)">işlem</div>
      </div>
    </div>`,

  'card-screen': () => `
    <div class="card" id="card-screen">
      <div class="card-header">
        <i data-lucide="monitor" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">Ekran</span>
      </div>
      <div style="margin-top:4px">
        <div style="font-size:16px;font-weight:600;color:var(--text-primary)" id="displayRes">— × —</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px" id="displayHz">— Hz</div>
      </div>
    </div>`,

  'card-disk': () => `
    <div class="card" id="card-disk">
      <div class="card-header">
        <i data-lucide="hard-drive" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">Disk</span>
      </div>
      <div class="value" id="diskVal" style="color:#34d399">—<span class="unit">%</span></div>
      <div class="bar-bg"><div class="bar" id="diskBar" style="background:#10b981;width:0%"></div></div>
      <div class="sub" id="diskFree">Boş: — GB</div>
    </div>`,

  'card-net': () => `
    <div class="card" id="card-net">
      <div class="card-header">
        <i data-lucide="wifi" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">Ağ</span>
      </div>
      <div class="net-row">
        <div>
          <div class="net-label">
            <i data-lucide="arrow-down" style="width:11px;height:11px;color:#34d399"></i>İndirme
          </div>
          <div class="net-val" id="dlVal" style="color:#34d399">— MB/s</div>
        </div>
        <div>
          <div class="net-label">
            <i data-lucide="arrow-up" style="width:11px;height:11px;color:#60a5fa"></i>Yükleme
          </div>
          <div class="net-val" id="ulVal" style="color:#60a5fa">— MB/s</div>
        </div>
      </div>
    </div>`,

  'card-weather': () => `
    <div class="card" id="card-weather" style="position:relative">
      <div class="card-header" style="justify-content:space-between">
        <div style="display:flex;align-items:center;gap:6px">
          <i data-lucide="map-pin" style="width:13px;height:13px;color:var(--text-muted)"></i>
          <span class="label">Hava Durumu — <span id="cityName">—</span></span>
        </div>
        <button id="editCityBtn" style="background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;">
          <i data-lucide="pencil" style="width:12px;height:12px;color:var(--text-muted)"></i>
        </button>
      </div>
      <div id="cityForm" style="display:none;margin-bottom:10px;position:relative">
        <div style="position:relative">
          <i data-lucide="search" style="width:12px;height:12px;color:var(--text-muted);position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none"></i>
          <input id="cityInput" type="text" placeholder="Şehir ara..."
            style="width:100%;background:var(--bg-input);border:1px solid var(--border-input);border-radius:8px;padding:6px 10px 6px 28px;color:var(--text-primary);font-size:13px;outline:none;" />
        </div>
        <div id="cityDropdown" style="display:none;position:absolute;left:0;right:0;top:38px;background:var(--bg-card);border:1px solid var(--border-input);border-radius:10px;overflow:hidden;z-index:999;max-height:160px;overflow-y:auto"></div>
      </div>
      <div id="weatherEmpty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px 0;gap:8px">
        <i data-lucide="map-pin-off" style="width:28px;height:28px;color:#3d4460"></i>
        <div style="font-size:13px;color:var(--text-muted);text-align:center">Hava durumu için<br>bir şehir seçin</div>
        <button id="selectCityBtn" style="margin-top:4px;background:var(--bg-input);border:1px solid var(--border-input);border-radius:8px;padding:6px 16px;color:var(--text-secondary);font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px">
          <i data-lucide="search" style="width:12px;height:12px"></i>Şehir Seç
        </button>
      </div>
      <div id="weatherData" style="display:none">
        <div class="weather-row">
          <div class="weather-icon" id="weatherIcon">
            <i data-lucide="cloud" style="width:26px;height:26px;color:#94a3b8"></i>
          </div>
          <div class="weather-info">
            <div style="font-size:28px;font-weight:600;color:#fbbf24;line-height:1" id="weatherTemp">—<span class="unit">°C</span></div>
            <div style="font-size:13px;color:var(--text-primary);margin-top:2px" id="weatherDesc">—</div>
            <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px;margin-top:2px">
              <i data-lucide="droplets" style="width:11px;height:11px"></i>
              <span id="weatherHumidity">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>`
}

// ── Layout render ───────────────────────────────────────────────
function renderLayout(layout, visible) {
  currentLayout = layout
  currentVisible = visible
  const content = document.getElementById('content')
  content.innerHTML = ''

  layout.forEach(item => {
    if (item.type === 'single') {
      if (!visible.includes(item.id)) return
      const tpl = CARD_TEMPLATES[item.id]
      if (tpl) content.insertAdjacentHTML('beforeend', tpl())
    } else if (item.type === 'group') {
      const visibleChildren = item.children.filter(c => visible.includes(c))
      if (visibleChildren.length === 0) return
      if (visibleChildren.length === 1) {
        const tpl = CARD_TEMPLATES[visibleChildren[0]]
        if (tpl) content.insertAdjacentHTML('beforeend', tpl())
      } else {
        const group = document.createElement('div')
        group.className = 'card-group'
        group.id = item.id
        group.style.overflow = 'hidden'
        visibleChildren.forEach(c => {
          const tpl = CARD_TEMPLATES[c]
          if (tpl) group.insertAdjacentHTML('beforeend', tpl())
        })
        content.appendChild(group)
      }
    }
  })

  lucide.createIcons()
  initWeatherListeners()
  setTimeout(() => {
  ipcRenderer.send('set-window-height', calcHeight(layout, visible))
}, 50)
}

// ── Saat ────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('clock')
  const dateEl = document.getElementById('dateStr')
  if (!el) return
  const now = new Date()
  el.textContent = now.toLocaleTimeString('tr-TR')
  dateEl.textContent = now.toLocaleDateString('tr-TR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}
setInterval(updateClock, 1000)

// ── Sistem ──────────────────────────────────────────────────────
async function updateSystem() {
  const d = await ipcRenderer.invoke('get-system')
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html }
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt }
  const setStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val }

  set('cpuVal', `${d.cpu}<span class="unit">%</span>`)
  setStyle('cpuBar', 'width', `${d.cpu}%`)
  set('ramVal', `${d.ram.used}<span class="unit">GB</span>`)
  setStyle('ramBar', 'width', `${d.ram.percent}%`)
  setText('ramSub', `${d.ram.used} / ${d.ram.total} GB`)
  setText('procAll', d.processes.all)
  set('diskVal', `${d.disk.percent}<span class="unit">%</span>`)
  setStyle('diskBar', 'width', `${d.disk.percent}%`)
  setText('diskFree', `Boş: ${d.disk.free} GB`)
  if (d.display) {
    setText('displayRes', `${d.display.width} × ${d.display.height}`)
    setText('displayHz', `${d.display.hz} Hz`)
  }
  setText('uptime', d.uptime)
  setText('dlVal', `${d.net.download} MB/s`)
  setText('ulVal', `${d.net.upload} MB/s`)
}
setInterval(updateSystem, 2000)

// ── Hava Durumu ─────────────────────────────────────────────────
const iconMap = {
  'Açık':            { icon: 'sun',            color: '#fbbf24' },
  'Az bulutlu':      { icon: 'cloud-sun',       color: '#fbbf24' },
  'Parçalı bulutlu': { icon: 'cloud-sun',       color: '#94a3b8' },
  'Bulutlu':         { icon: 'cloud',           color: '#94a3b8' },
  'Sisli':           { icon: 'wind',            color: '#94a3b8' },
  'Çisenti':         { icon: 'cloud-drizzle',   color: '#60a5fa' },
  'Yağmurlu':        { icon: 'cloud-rain',      color: '#60a5fa' },
  'Karlı':           { icon: 'cloud-snow',      color: '#e2e8f0' },
  'Sağanak':         { icon: 'cloud-rain',      color: '#3b82f6' },
  'Fırtına':         { icon: 'cloud-lightning', color: '#f59e0b' },
}

async function updateWeather() {
  const city = await ipcRenderer.invoke('get-city')
  if (!city) return
  const w = await ipcRenderer.invoke('get-weather')
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html }
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt }

  const empty = document.getElementById('weatherEmpty')
  const data = document.getElementById('weatherData')
  if (empty) empty.style.display = 'none'
  if (data) data.style.display = 'block'

  setText('cityName', w.city)
  set('weatherTemp', `${w.temp}<span class="unit">°C</span>`)
  setText('weatherDesc', w.desc)
  setText('weatherHumidity', `Nem %${w.humidity}`)

  const match = iconMap[w.desc] || { icon: 'cloud', color: '#94a3b8' }
  set('weatherIcon', `<i data-lucide="${match.icon}" style="width:26px;height:26px;color:${match.color}"></i>`)
  lucide.createIcons()
}

async function initWeather() {
  const city = await ipcRenderer.invoke('get-city')
  if (!city) {
    const empty = document.getElementById('weatherEmpty')
    const data = document.getElementById('weatherData')
    if (empty) empty.style.display = 'flex'
    if (data) data.style.display = 'none'
  } else {
    updateWeather()
  }
}
setInterval(updateWeather, 5 * 60 * 1000)

function initWeatherListeners() {
  const editBtn = document.getElementById('editCityBtn')
  const selectBtn = document.getElementById('selectCityBtn')
  const cityInput = document.getElementById('cityInput')

  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const form = document.getElementById('cityForm')
      const isVisible = form.style.display !== 'none'
      form.style.display = isVisible ? 'none' : 'block'
      document.getElementById('cityDropdown').style.display = 'none'
      if (!isVisible) {
        cityInput.value = ''
        setTimeout(() => cityInput.focus(), 50)
      }
    })
  }

  if (selectBtn) {
    selectBtn.addEventListener('click', () => {
      document.getElementById('cityForm').style.display = 'block'
      cityInput.focus()
    })
  }

  if (cityInput) {
    let searchTimeout
    cityInput.addEventListener('input', async (e) => {
      const query = e.target.value.trim()
      const dropdown = document.getElementById('cityDropdown')
      if (query.length < 2) { dropdown.style.display = 'none'; return }
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(async () => {
        try {
          const res = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=tr`
          )
          const data = await res.json()
          const results = data.results || []
          if (results.length === 0) {
            dropdown.innerHTML = `<div style="padding:12px 14px;font-size:13px;color:var(--text-muted);text-align:center">Şehir bulunamadı</div>`
            dropdown.style.display = 'block'
            return
          }
          dropdown.innerHTML = results.map((r, i) => `
            <div class="city-result" data-name="${r.name}"
              style="padding:10px 14px;cursor:pointer;border-bottom:${i < results.length - 1 ? '1px solid var(--border)' : 'none'};display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:13px;color:var(--text-primary);font-weight:500">${r.name}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${[r.admin1, r.country].filter(Boolean).join(', ')}</div>
              </div>
              <i data-lucide="map-pin" style="width:11px;height:11px;color:var(--text-muted);flex-shrink:0"></i>
            </div>
          `).join('')
          dropdown.style.display = 'block'
          lucide.createIcons()
          dropdown.querySelectorAll('.city-result').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-input)')
            el.addEventListener('mouseleave', () => el.style.background = 'none')
            el.addEventListener('click', () => {
              ipcRenderer.send('set-city', el.dataset.name)
              cityInput.value = ''
              dropdown.style.display = 'none'
              document.getElementById('cityForm').style.display = 'none'
              updateWeather()
            })
          })
        } catch { dropdown.style.display = 'none' }
      }, 350)
    })
  }

  document.addEventListener('click', (e) => {
    const form = document.getElementById('cityForm')
    const dropdown = document.getElementById('cityDropdown')
    if (form && !form.contains(e.target) && e.target.id !== 'editCityBtn' && e.target.id !== 'selectCityBtn') {
      form.style.display = 'none'
      if (dropdown) dropdown.style.display = 'none'
    }
  })
}

// ── Tema ────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light')
  document.getElementById('themeIcon').setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun')
  lucide.createIcons()
}

async function initTheme() {
  const theme = await ipcRenderer.invoke('get-theme')
  applyTheme(theme)
}

document.getElementById('themeBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  const current = document.body.classList.contains('light') ? 'light' : 'dark'
  const next = current === 'light' ? 'dark' : 'light'
  ipcRenderer.send('set-theme', next)
  applyTheme(next)
})

// ── Layout güncellemeleri (editor'dan) ─────────────────────────
ipcRenderer.on('layout-updated', (_, layout) => {
  ipcRenderer.invoke('get-visible').then(visible => {
    renderLayout(layout, visible)
    updateClock()
    updateSystem()
    initWeather()
  })
})

ipcRenderer.on('visible-updated', (_, visible) => {
  ipcRenderer.invoke('get-layout').then(layout => {
    renderLayout(layout, visible)
    updateClock()
    updateSystem()
    initWeather()
  })
})

// ── Başlat ──────────────────────────────────────────────────────
async function init() {
  await initTheme()
  const [layout, visible] = await Promise.all([
    ipcRenderer.invoke('get-layout'),
    ipcRenderer.invoke('get-visible')
  ])
  renderLayout(layout, visible)
  updateClock()
  updateSystem()
  initWeather()
}
init()

document.getElementById('editorBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  ipcRenderer.send('open-editor')
})

document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('close-app')
})