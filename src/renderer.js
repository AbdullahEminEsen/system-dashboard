const { ipcRenderer } = require('electron')

// Saat
function updateClock() {
  const now = new Date()
  document.getElementById('clock').textContent = now.toLocaleTimeString('tr-TR')
  document.getElementById('dateStr').textContent = now.toLocaleDateString('tr-TR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}
setInterval(updateClock, 1000)
updateClock()

// Sistem
async function updateSystem() {
  const d = await ipcRenderer.invoke('get-system')

  // CPU
  document.getElementById('cpuVal').innerHTML = `${d.cpu}<span class="unit">%</span>`
  document.getElementById('cpuBar').style.width = `${d.cpu}%`

  // RAM
  document.getElementById('ramVal').innerHTML = `${d.ram.used}<span class="unit">GB</span>`
  document.getElementById('ramBar').style.width = `${d.ram.percent}%`
  document.getElementById('ramSub').textContent = `${d.ram.used} / ${d.ram.total} GB`

  // İşlemler
  document.getElementById('procAll').textContent = d.processes.all

  // Disk
  document.getElementById('diskVal').innerHTML = `${d.disk.percent}<span class="unit">%</span>`
  document.getElementById('diskBar').style.width = `${d.disk.percent}%`
  document.getElementById('diskFree').textContent = `Boş: ${d.disk.free} GB`

  // Ekran
  if (d.display) {
    document.getElementById('displayRes').textContent = `${d.display.width} × ${d.display.height}`
    document.getElementById('displayHz').textContent = `${d.display.hz} Hz`
  }

  // Uptime
  document.getElementById('uptime').textContent = d.uptime
  // Ağ
  document.getElementById('dlVal').textContent = `${d.net.download} MB/s`
  document.getElementById('ulVal').textContent = `${d.net.upload} MB/s`
}
setInterval(updateSystem, 2000)
updateSystem()

// Hava durumu
const iconMap = {
  'Açık':             { icon: 'sun',            color: '#fbbf24' },
  'Az bulutlu':       { icon: 'cloud-sun',       color: '#fbbf24' },
  'Parçalı bulutlu':  { icon: 'cloud-sun',       color: '#94a3b8' },
  'Bulutlu':          { icon: 'cloud',           color: '#94a3b8' },
  'Sisli':            { icon: 'wind',            color: '#94a3b8' },
  'Çisenti':          { icon: 'cloud-drizzle',   color: '#60a5fa' },
  'Yağmurlu':         { icon: 'cloud-rain',      color: '#60a5fa' },
  'Karlı':            { icon: 'cloud-snow',      color: '#e2e8f0' },
  'Sağanak':          { icon: 'cloud-rain',      color: '#3b82f6' },
  'Fırtına':          { icon: 'cloud-lightning', color: '#f59e0b' },
}

async function updateWeather() {
  const city = await ipcRenderer.invoke('get-city')
  if (!city) return

  const w = await ipcRenderer.invoke('get-weather')

  document.getElementById('weatherEmpty').style.display = 'none'
  document.getElementById('weatherData').style.display = 'block'
  document.getElementById('cityName').textContent = w.city

  document.getElementById('weatherTemp').innerHTML = `${w.temp}<span class="unit">°C</span>`
  document.getElementById('weatherDesc').textContent = w.desc
  document.getElementById('weatherHumidity').textContent = `Nem %${w.humidity}`

  const match = iconMap[w.desc] || { icon: 'cloud', color: '#94a3b8' }
  document.getElementById('weatherIcon').innerHTML =
    `<i data-lucide="${match.icon}" style="width:26px;height:26px;color:${match.color}"></i>`
  lucide.createIcons()
}

// İlk açılışta şehir var mı kontrol et
async function initWeather() {
  const city = await ipcRenderer.invoke('get-city')
  if (!city) {
    document.getElementById('weatherEmpty').style.display = 'flex'
    document.getElementById('weatherData').style.display = 'none'
    document.getElementById('cityName').textContent = '—'
  } else {
    updateWeather()
  }
}

setInterval(updateWeather, 5 * 60 * 1000)
initWeather()

// Kalem butonu
document.getElementById('editCityBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  const form = document.getElementById('cityForm')
  const isVisible = form.style.display !== 'none'
  form.style.display = isVisible ? 'none' : 'block'
  document.getElementById('cityDropdown').style.display = 'none'
  if (!isVisible) {
    document.getElementById('cityInput').value = ''
    document.getElementById('cityInput').focus()
  }
})

// "Şehir Seç" butonu
document.getElementById('selectCityBtn').addEventListener('click', () => {
  document.getElementById('cityForm').style.display = 'block'
  document.getElementById('cityInput').focus()
})

// Canlı arama
let searchTimeout
document.getElementById('cityInput').addEventListener('input', async (e) => {
  const query = e.target.value.trim()
  const dropdown = document.getElementById('cityDropdown')

  if (query.length < 2) {
    dropdown.style.display = 'none'
    return
  }

  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=tr`
      )
      const data = await res.json()
      const results = data.results || []

      if (results.length === 0) {
        dropdown.innerHTML = `
          <div style="padding:12px 14px;font-size:13px;color:#64748b;text-align:center">
            Şehir bulunamadı
          </div>`
        dropdown.style.display = 'block'
        return
      }

      dropdown.innerHTML = results.map((r, i) => `
        <div class="city-result" data-name="${r.name}" data-country="${r.country || ''}"
          style="padding:10px 14px;cursor:pointer;border-bottom:${i < results.length - 1 ? '1px solid #2d3148' : 'none'};
          display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:13px;color:#e2e8f0;font-weight:500">${r.name}</div>
            <div style="font-size:11px;color:#64748b;margin-top:1px">${[r.admin1, r.country].filter(Boolean).join(', ')}</div>
          </div>
          <i data-lucide="map-pin" style="width:11px;height:11px;color:#3d4460;flex-shrink:0"></i>
        </div>
      `).join('')

      dropdown.style.display = 'block'
      lucide.createIcons()

      // Şehre tıklama
      dropdown.querySelectorAll('.city-result').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.background = '#2d3148')
        el.addEventListener('mouseleave', () => el.style.background = 'none')
        el.addEventListener('click', () => {
          const name = el.dataset.name
          ipcRenderer.send('set-city', name)
          document.getElementById('cityInput').value = ''
          dropdown.style.display = 'none'
          document.getElementById('cityForm').style.display = 'none'
          updateWeather()
        })
      })
    } catch {
      dropdown.style.display = 'none'
    }
  }, 350)
})

// Tema
async function initTheme() {
  const theme = await ipcRenderer.invoke('get-theme')
  applyTheme(theme)
}

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light')
  const icon = document.getElementById('themeIcon')
  icon.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun')
  lucide.createIcons()
}

document.getElementById('themeBtn').addEventListener('click', async (e) => {
  e.stopPropagation()
  const current = document.body.classList.contains('light') ? 'light' : 'dark'
  const next = current === 'light' ? 'dark' : 'light'
  ipcRenderer.send('set-theme', next)
  applyTheme(next)
})

initTheme()

// Dışarı tıklayınca kapat
document.addEventListener('click', (e) => {
  if (!document.getElementById('cityForm').contains(e.target) &&
      e.target.id !== 'editCityBtn' && e.target.id !== 'selectCityBtn') {
    document.getElementById('cityForm').style.display = 'none'
    document.getElementById('cityDropdown').style.display = 'none'
  }
})

// Kapat
document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('close-app')
})