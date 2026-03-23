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
  await Promise.all([initTheme(), initOpacity(), initPin()])
}
init()

document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('close-settings')
})