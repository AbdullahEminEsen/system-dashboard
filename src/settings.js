// settings.js — runs under contextIsolation:true.
// IPC via window.api, i18n via window.i18n.
// Wrapped in an IIFE so top-level bindings can't collide with another script in
// the page's shared global scope (see the note in editor.js / renderer.js).
;(() => {
const api = window.api
const i18nRef = window.i18n

// ── Tema ────────────────────────────────────────────────────────
async function initTheme() {
  const theme = await api.invoke('get-theme')
  const isLight = theme === 'light'
  document.body.classList.toggle('light', isLight)
  document.getElementById('themeToggle').checked = isLight
  document.getElementById('themeSubLabel').textContent = isLight ? 'Aydınlık mod' : 'Karanlık mod'
}

document.getElementById('themeToggle').addEventListener('change', (e) => {
  const theme = e.target.checked ? 'light' : 'dark'
  api.send('set-theme', theme)
  document.body.classList.toggle('light', e.target.checked)
  document.getElementById('themeSubLabel').textContent = e.target.checked ? 'Aydınlık mod' : 'Karanlık mod'
})

api.on('theme-changed', (theme) => {
  const isLight = theme === 'light'
  document.body.classList.toggle('light', isLight)
  document.getElementById('themeToggle').checked = isLight
  document.getElementById('themeSubLabel').textContent = isLight ? 'Aydınlık mod' : 'Karanlık mod'
})

// ── Opaklık ─────────────────────────────────────────────────────
async function initOpacity() {
  const val = await api.invoke('get-opacity')
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
    api.send('set-opacity', val)
    updateOpacityUI(val)
  })
})

// ── Dil ─────────────────────────────────────────────────────────
async function initLang() {
  const lang = await api.invoke('get-lang')
  updateLangUI(lang)
}

function updateLangUI(lang) {
  const t = i18nRef[lang]

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.style.color = btn.dataset.lang === lang ? 'var(--text-primary)' : 'var(--text-muted)'
    btn.style.borderColor = btn.dataset.lang === lang ? '#3b82f6' : 'var(--border-input)'
  })

  document.querySelectorAll('.section-label')[0].textContent = t.appearance
  document.querySelectorAll('.section-label')[1].textContent = t.behavior

  document.querySelector('.titlebar h1').textContent = t.settings
  document.getElementById('themeSubLabel').textContent =
    document.getElementById('themeToggle').checked ? t.themeLight : t.themeDark
  document.getElementById('themeLabelText').textContent = t.theme
  document.getElementById('opacityLabelText').textContent = t.opacity
  document.getElementById('alwaysOnTopLabelText').textContent = t.alwaysOnTop
  document.getElementById('alwaysOnTopSubText').textContent = t.alwaysOnTopDesc
  // NOTE: labels/sub-labels above are targeted by id. The previous version also
  // reassigned them positionally via querySelectorAll('.setting-*'), and one of
  // those lines wrote t.alwaysOnTopDesc into .setting-sub[1] — the *opacity*
  // sub-label — wiping out the "%NN" percentage on every language switch. The
  // id-based sets already cover every label, so the positional lines are gone.
}

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    api.send('set-lang', btn.dataset.lang)
    updateLangUI(btn.dataset.lang)
  })
})

api.on('lang-changed', (lang) => updateLangUI(lang))

// ── Pin ─────────────────────────────────────────────────────────
async function initPin() {
  const val = await api.invoke('get-always-on-top')
  document.getElementById('pinToggle').checked = val
}

document.getElementById('pinToggle').addEventListener('change', (e) => {
  api.send('set-always-on-top', e.target.checked)
})

// ── Başlat ──────────────────────────────────────────────────────
async function init() {
  await Promise.all([initTheme(), initOpacity(), initPin(), initLang()])
}
init()

document.getElementById('closeBtn').addEventListener('click', () => {
  api.send('close-settings')
})

})()
