const { ipcRenderer } = require('electron')

// ── Tema ────────────────────────────────────────────────────────
async function initTheme() {
  const theme = await ipcRenderer.invoke('get-theme')
  const isLight = theme === 'light'
  document.body.classList.toggle('light', isLight)
  document.getElementById('themeToggle').checked = isLight
  document.getElementById('themeSubLabel').textContent = isLight ? 'Aydınlık mod' : 'Karanlık mod'
}

document.getElementById('themeToggle').addEventListener('change', (e) => {
  const theme = e.target.checked ? 'light' : 'dark'
  ipcRenderer.send('set-theme', theme)
  document.body.classList.toggle('light', e.target.checked)
  document.getElementById('themeSubLabel').textContent = e.target.checked ? 'Aydınlık mod' : 'Karanlık mod'
})

ipcRenderer.on('theme-changed', (_, theme) => {
  const isLight = theme === 'light'
  document.body.classList.toggle('light', isLight)
  document.getElementById('themeToggle').checked = isLight
  document.getElementById('themeSubLabel').textContent = isLight ? 'Aydınlık mod' : 'Karanlık mod'
})

// ── Opaklık ─────────────────────────────────────────────────────
async function initOpacity() {
  const val = await ipcRenderer.invoke('get-opacity')
  updateOpacityUI(val)
}

function updateOpacityUI(val) {
  document.getElementById('opacitySubLabel').textContent = `%${Math.round(val * 100)}`
  document.querySelectorAll('.opacity-block').forEach(block => {
    block.classList.toggle('active', parseFloat(block.dataset.val) === val)
  })
}

document.querySelectorAll('.opacity-block').forEach(block => {
  block.addEventListener('click', () => {
    const val = parseFloat(block.dataset.val)
    ipcRenderer.send('set-opacity', val)
    updateOpacityUI(val)
  })
})

// ── Dil ─────────────────────────────────────────────────────────
async function initLang() {
  const lang = await ipcRenderer.invoke('get-lang')
  updateLangUI(lang)
}

function updateLangUI(lang) {
  const i18n = require('./i18n')
  const t = i18n[lang]

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.style.color = btn.dataset.lang === lang ? 'var(--text-primary)' : 'var(--text-muted)'
    btn.style.borderColor = btn.dataset.lang === lang ? '#3b82f6' : 'var(--border-input)'
  })

  // Section label'ları güncelle
  document.querySelectorAll('.section-label')[0].textContent = t.appearance
  document.querySelectorAll('.section-label')[1].textContent = t.behavior

  // Setting label'ları güncelle
  document.querySelector('.titlebar h1').textContent = t.settings
  document.getElementById('themeSubLabel').textContent =
    document.getElementById('themeToggle').checked ? t.themeLight : t.themeDark
  document.getElementById('themeLabelText').textContent = t.theme
  document.getElementById('opacityLabelText').textContent = t.opacity
  document.getElementById('alwaysOnTopLabelText').textContent = t.alwaysOnTop
  document.getElementById('alwaysOnTopSubText').textContent = t.alwaysOnTopDesc
  document.querySelectorAll('.setting-label')[0].textContent = t.theme
  document.querySelectorAll('.setting-label')[1].textContent = t.opacity
  document.querySelectorAll('.setting-label')[3].textContent = t.alwaysOnTop
  document.querySelectorAll('.setting-sub')[1].textContent = t.alwaysOnTopDesc
}

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    ipcRenderer.send('set-lang', btn.dataset.lang)
    updateLangUI(btn.dataset.lang)
  })
})

ipcRenderer.on('lang-changed', (_, lang) => updateLangUI(lang))

// ── Pin ─────────────────────────────────────────────────────────
async function initPin() {
  const val = await ipcRenderer.invoke('get-always-on-top')
  document.getElementById('pinToggle').checked = val
}

document.getElementById('pinToggle').addEventListener('change', (e) => {
  ipcRenderer.send('set-always-on-top', e.target.checked)
})

// ── Başlat ──────────────────────────────────────────────────────
async function init() {
  await Promise.all([initTheme(), initOpacity(), initPin(), initLang()])
}
init()

document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('close-settings')
})