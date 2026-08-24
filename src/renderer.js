// renderer.js — runs under contextIsolation:true.
// IPC is exposed via window.api by preload.js; i18n via window.i18n.
// Wrapped in an IIFE so all top-level `const` bindings stay private to this
// script and cannot collide with anything else in the page's script scope.
; (() => {
  const api = window.api
  const i18n = window.i18n

  let currentLang = 'tr'
  let t = i18n[currentLang]

  async function initLang() {
    currentLang = await api.invoke('get-lang')
    t = i18n[currentLang]
  }

  api.on('lang-changed', (lang) => {
    currentLang = lang
    t = i18n[lang]
    renderLayout(currentLayout, currentVisible)
  })

  // ── Sabit yükseklikler ──────────────────────────────────────────
  const CARD_HEIGHTS = {
    'card-clock': 95,
    'card-cpu': 90,
    'card-ram': 100,
    'card-gpu': 200,
    'card-proc': 85,
    'card-screen': 80,
    'card-disk': 100,
    'card-net': 90,
  }
  const GAP = 10
  const PADDING = 70

  function calcHeight(layout, visible) {
    let total = PADDING
    let itemCount = 0
    layout.forEach(item => {
      if (item.type === 'single') {
        if (!visible.includes(item.id)) return
        const el = document.getElementById(item.id)
        total += el ? el.offsetHeight : (CARD_HEIGHTS[item.id] || 90)
        itemCount++
      } else if (item.type === 'group' && Array.isArray(item.children)) {
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
    return Math.max(100, total)
  }

  let currentLayout = []
  let currentVisible = []

  // ── DOM helpers (hoisted for reuse, no closures per push) ──────
  function elById(id) { return document.getElementById(id) }
  function setHTML(id, html) { const el = elById(id); if (el && el.innerHTML !== html) el.innerHTML = html }
  function setText(id, txt) {
    const el = elById(id)
    const s = String(txt)
    if (el && el.textContent !== s) el.textContent = s
  }
  function setStyle(id, prop, val) {
    const el = elById(id)
    if (el && el.style[prop] !== val) el.style[prop] = val
  }

  // ── Kart şablonları ─────────────────────────────────────────────
  const CARD_TEMPLATES = {
    'card-clock': () => `
    <div class="card" id="card-clock">
      <div class="card-header">
        <i data-lucide="clock-3" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">${t.clock}</span>
      </div>
      <div class="clock-value" id="clock">--:--:--</div>
      <div class="sub" id="dateStr">—</div>
    </div>`,

    'card-cpu': () => `
    <div class="card" id="card-cpu">
      <div class="card-header" style="justify-content:space-between">
        <div style="display:flex;align-items:center;gap:6px">
          <i data-lucide="cpu" style="width:13px;height:13px;color:var(--text-muted)"></i>
          <span class="label">${t.cpu}</span>
        </div>
        <button id="cpuBenchBtn" style="background:none;border:1px solid var(--border-input);border-radius:6px;padding:2px 8px;font-size:11px;color:var(--text-muted);cursor:pointer">
          Benchmark
        </button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="value" id="cpuVal" style="color:#60a5fa">—<span class="unit">%</span></div>
        <div id="cpuTempWrap" style="display:none;align-items:center;gap:4px">
          <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">${t.temp}</span>
          <span style="font-size:16px;font-weight:600;color:#fb923c" id="cpuTempVal">—<span class="unit">°C</span></span>
        </div>
      </div>
      <div class="bar-bg"><div class="bar" id="cpuBar" style="background:#3b82f6;width:0%"></div></div>
    </div>`,

    'card-ram': () => `
    <div class="card" id="card-ram">
      <div class="card-header">
        <i data-lucide="memory-stick" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">${t.ram}</span>
      </div>
      <div class="value" id="ramVal" style="color:#a78bfa">—<span class="unit">GB</span></div>
      <div class="bar-bg"><div class="bar" id="ramBar" style="background:#8b5cf6;width:0%"></div></div>
      <div class="sub" id="ramSub">— / — GB</div>
    </div>`,

    'card-gpu': () => `
    <div class="card" id="card-gpu">
      <div class="card-header" style="justify-content:space-between">
        <div style="display:flex;align-items:center;gap:6px">
          <i data-lucide="monitor-check" style="width:13px;height:13px;color:var(--text-muted)"></i>
          <span class="label">${t.gpu}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button id="gpuBenchBtn" style="background:none;border:1px solid var(--border-input);border-radius:6px;padding:2px 8px;font-size:11px;color:var(--text-muted);cursor:pointer">
            Benchmark
          </button>
          <select id="gpuSelect" style="background:var(--bg-input);border:1px solid var(--border-input);border-radius:6px;padding:2px 6px;font-size:11px;color:var(--text-muted);cursor:pointer;outline:none;max-width:120px">
          </select>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="gpuName">—</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${t.usage}</div>
          <div style="font-size:20px;font-weight:600;color:#f472b6" id="gpuLoad">—<span class="unit">%</span></div>
          <div class="bar-bg"><div class="bar" id="gpuBar" style="background:#ec4899;width:0%"></div></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${t.temp}</div>
          <div style="font-size:20px;font-weight:600;color:#fb923c" id="gpuTemp">—<span class="unit">°C</span></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${t.memUsage}</div>
          <div style="font-size:20px;font-weight:600;color:#a78bfa" id="gpuMemLoad">—<span class="unit">%</span></div>
          <div class="bar-bg"><div class="bar" id="gpuMemBar" style="background:#8b5cf6;width:0%"></div></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${t.power}</div>
          <div style="font-size:20px;font-weight:600;color:#34d399" id="gpuPower">—<span class="unit">W</span></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:11px;color:var(--text-muted)">${t.vramUsed}</div>
        <div style="font-size:11px;font-weight:500" id="gpuVramUsed">— / — MB</div>
      </div>
    </div>`,

    'card-proc': () => `
    <div class="card" id="card-proc">
      <div class="card-header">
        <i data-lucide="layers" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">${t.processes}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-top:4px">
        <div style="font-size:32px;font-weight:600;color:#60a5fa;line-height:1" id="procAll">—</div>
        <div style="font-size:12px;color:var(--text-muted)" id="procUnit">${t.processUnit}</div>
      </div>
    </div>`,

    'card-screen': () => `
    <div class="card" id="card-screen">
      <div class="card-header" style="justify-content:space-between">
        <div style="display:flex;align-items:center;gap:6px">
          <i data-lucide="monitor" style="width:13px;height:13px;color:var(--text-muted)"></i>
          <span class="label">${t.screen}</span>
        </div>
        <select id="displaySelect" style="background:var(--bg-input);border:1px solid var(--border-input);border-radius:6px;padding:2px 6px;font-size:11px;color:var(--text-muted);cursor:pointer;outline:none;max-width:100px">
        </select>
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
        <span class="label">${t.disk}</span>
      </div>
      <div class="value" id="diskVal" style="color:#34d399">—<span class="unit">%</span></div>
      <div class="bar-bg"><div class="bar" id="diskBar" style="background:#10b981;width:0%"></div></div>
      <div class="sub" id="diskFree">${t.diskFree('—')}</div>
    </div>`,

    'card-net': () => `
    <div class="card" id="card-net">
      <div class="card-header">
        <i data-lucide="wifi" style="width:13px;height:13px;color:var(--text-muted)"></i>
        <span class="label">${t.net}</span>
      </div>
      <div class="net-row">
        <div>
          <div class="net-label">
            <i data-lucide="arrow-down" style="width:11px;height:11px;color:#34d399"></i>${t.download}
          </div>
          <div class="net-val" id="dlVal" style="color:#34d399">— MB/s</div>
        </div>
        <div>
          <div class="net-label">
            <i data-lucide="arrow-up" style="width:11px;height:11px;color:#60a5fa"></i>${t.upload}
          </div>
          <div class="net-val" id="ulVal" style="color:#60a5fa">— MB/s</div>
        </div>
      </div>
    </div>`
  }

  // ── Layout render ───────────────────────────────────────────────
  function renderLayout(layout, visible) {
    currentLayout = layout
    currentVisible = visible
    prevPayload = {} // structural change invalidates diff cache
    const content = elById('content')
    if (!content) return
    content.innerHTML = ''
    layout.forEach(item => {
      if (item.type === 'single') {
        if (!visible.includes(item.id)) return
        const tpl = CARD_TEMPLATES[item.id]
        if (tpl) content.insertAdjacentHTML('beforeend', tpl())
      } else if (item.type === 'group' && Array.isArray(item.children)) {
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
    // single createIcons after all structural changes
    lucide.createIcons()
    initSelectListeners()
    setTimeout(() => api.send('set-window-height', calcHeight(layout, visible)), 50)
  }

  // ── Saat ────────────────────────────────────────────────────────
  function updateClock() {
    const el = elById('clock')
    const dateEl = elById('dateStr')
    if (!el) return
    const now = new Date()
    const locale = currentLang === 'tr' ? 'tr-TR' : 'en-US'
    const time = now.toLocaleTimeString(locale)
    if (el.textContent !== time) el.textContent = time
    const date = now.toLocaleDateString(locale, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
    if (dateEl && dateEl.textContent !== date) dateEl.textContent = date
  }
  setInterval(updateClock, 1000)

  // ── Sistem (push modeli, diffed render via rAF) ─────────────────
  let prevPayload = {}
  let pendingPayload = null
  let rafScheduled = false

  function applySystemUpdate(d, prev) {
    // CPU
    if (d.cpu !== prev.cpu) {
      setHTML('cpuVal', `${d.cpu}<span class="unit">%</span>`)
      setStyle('cpuBar', 'width', `${d.cpu}%`)
    }
    if (d.cpuTemp !== prev.cpuTemp) {
      const hasTemp = d.cpuTemp !== null && d.cpuTemp !== undefined
      // Hide the temperature entirely when there's no sensor reading (common on
      // Windows) so the CPU card isn't cluttered with a dangling "—°C".
      setStyle('cpuTempWrap', 'display', hasTemp ? 'flex' : 'none')
      if (hasTemp) setHTML('cpuTempVal', `${d.cpuTemp}<span class="unit">°C</span>`)
    }
    // RAM
    const pr = prev.ram || {}
    if (!pr || d.ram.used !== pr.used) setHTML('ramVal', `${d.ram.used}<span class="unit">GB</span>`)
    if (!pr || d.ram.percent !== pr.percent) setStyle('ramBar', 'width', `${d.ram.percent}%`)
    if (!pr || d.ram.used !== pr.used || d.ram.total !== pr.total) setText('ramSub', `${d.ram.used} / ${d.ram.total} GB`)

    // GPU
    const pg = prev.gpu || null
    if (d.gpu) {
      if (!pg || d.gpu.name !== pg.name) setText('gpuName', d.gpu.name)
      if (!pg || d.gpu.load !== pg.load) {
        if (d.gpu.load !== null) {
          setHTML('gpuLoad', `${d.gpu.load}<span class="unit">%</span>`)
          setStyle('gpuBar', 'width', `${d.gpu.load}%`)
        } else {
          setHTML('gpuLoad', `—<span class="unit">%</span>`)
          setStyle('gpuBar', 'width', '0%')
        }
      }
      if (!pg || d.gpu.temp !== pg.temp) {
        setHTML('gpuTemp', d.gpu.temp !== null ? `${d.gpu.temp}<span class="unit">°C</span>` : `—<span class="unit">°C</span>`)
      }
      if (!pg || d.gpu.memLoad !== pg.memLoad) {
        if (d.gpu.memLoad !== null) {
          setHTML('gpuMemLoad', `${d.gpu.memLoad}<span class="unit">%</span>`)
          setStyle('gpuMemBar', 'width', `${d.gpu.memLoad}%`)
        } else {
          setHTML('gpuMemLoad', `—<span class="unit">%</span>`)
          setStyle('gpuMemBar', 'width', '0%')
        }
      }
      if (!pg || d.gpu.power !== pg.power) {
        setHTML('gpuPower', d.gpu.power !== null ? `${d.gpu.power.toFixed(1)}<span class="unit">W</span>` : `—<span class="unit">W</span>`)
      }
      if (!pg || d.gpu.vramUsed !== pg.vramUsed || d.gpu.vram !== pg.vram) {
        setText('gpuVramUsed', (d.gpu.vramUsed !== null && d.gpu.vram !== null) ? `${d.gpu.vramUsed} / ${d.gpu.vram} MB` : '— / — MB')
      }
    }

    // Processes
    const pp = prev.processes || {}
    if (!pp || d.processes.all !== pp.all) setText('procAll', d.processes.all)
    setText('procUnit', t.processUnit)

    // Disk
    const pd = prev.disk || {}
    if (!pd || d.disk.percent !== pd.percent) {
      setHTML('diskVal', `${d.disk.percent}<span class="unit">%</span>`)
      setStyle('diskBar', 'width', `${d.disk.percent}%`)
    }
    if (!pd || d.disk.free !== pd.free) setText('diskFree', t.diskFree(d.disk.free))

    // Display
    if (d.display) {
      const pdp = prev.display || {}
      if (!pdp || d.display.width !== pdp.width || d.display.height !== pdp.height) setText('displayRes', `${d.display.width} × ${d.display.height}`)
      if (!pdp || d.display.hz !== pdp.hz) setText('displayHz', `${d.display.hz} Hz`)
    }

    // Uptime
    if (d.uptime !== prev.uptime) setText('uptime', d.uptime)

    // Net
    const pn = prev.net || {}
    if (!pn || d.net.download !== pn.download) setText('dlVal', `${d.net.download} MB/s`)
    if (!pn || d.net.upload !== pn.upload) setText('ulVal', `${d.net.upload} MB/s`)
  }

  api.on('system-update', (d) => {
    pendingPayload = d
    if (rafScheduled) return
    rafScheduled = true
    requestAnimationFrame(() => {
      rafScheduled = false
      const next = pendingPayload
      pendingPayload = null
      if (!next) return
      applySystemUpdate(next, prevPayload)
      prevPayload = next
    })
  })

  // ── Select listeners ─────────────────────────────────────────────
  async function initSelectListeners() {
    const gpuSelect = elById('gpuSelect')
    const displaySelect = elById('displaySelect')
    if (gpuSelect && !gpuSelect.dataset.wired) {
      const [gpus, selectedGpu] = await Promise.all([
        api.invoke('get-gpu-list'),
        api.invoke('get-selected-gpu')
      ])
      gpuSelect.innerHTML = gpus.map(g =>
        `<option value="${g.index}" ${g.index === selectedGpu ? 'selected' : ''}>${g.name.slice(0, 18)}</option>`
      ).join('')
      gpuSelect.addEventListener('change', (e) => {
        api.send('set-selected-gpu', parseInt(e.target.value, 10))
      })
      gpuSelect.dataset.wired = '1'
    }
    if (displaySelect && !displaySelect.dataset.wired) {
      const [displays, selectedDisplay] = await Promise.all([
        api.invoke('get-display-list'),
        api.invoke('get-selected-display')
      ])
      displaySelect.innerHTML = displays.map(dd =>
        `<option value="${dd.index}" ${dd.index === selectedDisplay ? 'selected' : ''}>${dd.name.slice(0, 16)}</option>`
      ).join('')
      displaySelect.addEventListener('change', (e) => {
        api.send('set-selected-display', parseInt(e.target.value, 10))
      })
      displaySelect.dataset.wired = '1'
    }
  }

  // ── Event delegation: benchmark buttons ─────────────────────────
  document.addEventListener('click', (e) => {
    const target = e.target
    const cpuBench = target.closest && target.closest('#cpuBenchBtn')
    const gpuBench = target.closest && target.closest('#gpuBenchBtn')
    if (cpuBench || gpuBench) {
      api.send('open-benchmark')
    }
  })

  // ── Tema ────────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light')
    const ti = elById('themeIcon')
    if (ti) {
      ti.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun')
      lucide.createIcons()
    }
  }

  async function initTheme() {
    const theme = await api.invoke('get-theme')
    applyTheme(theme)
  }

  document.getElementById('themeBtn').addEventListener('click', (e) => {
    e.stopPropagation()
    const current = document.body.classList.contains('light') ? 'light' : 'dark'
    const next = current === 'light' ? 'dark' : 'light'
    api.send('set-theme', next)
    applyTheme(next)
  })

  api.on('theme-changed', (theme) => applyTheme(theme))

  // ── Layout güncellemeleri ────────────────────────────────────────
  api.on('layout-updated', (layout) => {
    api.invoke('get-visible').then(visible => {
      renderLayout(layout, visible)
      updateClock()
    })
  })

  api.on('visible-updated', (visible) => {
    api.invoke('get-layout').then(layout => {
      renderLayout(layout, visible)
      updateClock()
    })
  })

  // ── Başlat ──────────────────────────────────────────────────────
  async function init() {
    await initTheme()
    await initLang()
    const [layout, visible] = await Promise.all([
      api.invoke('get-layout'),
      api.invoke('get-visible')
    ])
    renderLayout(layout, visible)
    updateClock()
  }
  init()

  document.getElementById('settingsBtn').addEventListener('click', (e) => {
    e.stopPropagation()
    api.send('open-settings')
  })

  document.getElementById('editorBtn').addEventListener('click', (e) => {
    e.stopPropagation()
    api.send('open-editor')
  })

  document.getElementById('closeBtn').addEventListener('click', () => {
    api.send('hide-app')
  })

})()