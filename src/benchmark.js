// benchmark.js — runs under contextIsolation:true.
// IPC via window.api. File saves go through main via save-benchmark-report.
// Wrapped in an IIFE so top-level bindings can't collide with another script in
// the page's shared global scope (see the note in editor.js / renderer.js).
;(() => {
const api = window.api

// ── State ────────────────────────────────────────────────────────
const MAX_SAMPLES = 600 // hard cap to bound memory regardless of duration
// Thermal safety cutoff: if either temperature reaches these, the test stops
// itself. These sit just below where hardware starts throttling, so a healthy
// machine never hits them — it's a safety net, not a normal stop condition.
const SAFETY_CPU_TEMP = 95
const SAFETY_GPU_TEMP = 90
let safetyTripped = false
let selectedType = 'both'
let selectedLoad = 75
let selectedDuration = 5 * 60 * 1000
let isRunning = false
let startTime = null
let samples = []
let benchmarkInterval = null
let progressInterval = null
let cpuWorkers = []
let cpuWorkerUrl = null
let gpuAnimFrame = null
let loadChart = null
let tempChart = null

// ── Tema ────────────────────────────────────────────────────────
async function initTheme() {
  const theme = await api.invoke('get-theme')
  document.body.classList.toggle('light', theme === 'light')
}
api.on('theme-changed', (theme) => document.body.classList.toggle('light', theme === 'light'))
initTheme()

// ── Test tipi seçimi ─────────────────────────────────────────────
document.querySelectorAll('[data-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedType = btn.dataset.type
  })
})

// ── Yük seviyesi seçimi ──────────────────────────────────────────
document.querySelectorAll('[data-load]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-load]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    if (btn.dataset.load === 'custom') {
      document.getElementById('customLoadSection').style.display = 'block'
      selectedLoad = parseInt(document.getElementById('customLoadRange').value, 10)
    } else {
      document.getElementById('customLoadSection').style.display = 'none'
      selectedLoad = parseInt(btn.dataset.load, 10)
    }
  })
})

document.getElementById('customLoadRange').addEventListener('input', (e) => {
  selectedLoad = parseInt(e.target.value, 10)
  document.getElementById('customLoadVal').textContent = `${selectedLoad}%`
})

// ── Süre seçimi ──────────────────────────────────────────────────
document.querySelectorAll('[data-min]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-min]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedDuration = parseInt(btn.dataset.min, 10) * 60 * 1000
  })
})

// ── GPU seçimi ───────────────────────────────────────────────────
// Chromium binds a GPU at startup, so this is a persisted preference applied on
// the next launch — not a live switch. Default is high-performance (discrete).
let appliedGpuMode = 'high'
api.invoke('get-gpu-highperf').then(hp => {
  appliedGpuMode = hp ? 'high' : 'low'
  document.querySelectorAll('[data-gpu]').forEach(b => b.classList.toggle('active', b.dataset.gpu === appliedGpuMode))
}).catch(() => {})

document.querySelectorAll('[data-gpu]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-gpu]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const mode = btn.dataset.gpu
    api.send('set-gpu-highperf', mode === 'high')
    const note = document.getElementById('gpuModeNote')
    if (note) note.textContent = mode !== appliedGpuMode
      ? '⟳ Değişiklik uygulamayı yeniden başlatınca geçerli olur.'
      : ''
  })
})

// ── CPU Stres ────────────────────────────────────────────────────
function startCpuStress(loadPercent) {
  const workerCode = `
    let running = true
    self.onmessage = (e) => {
      if (e.data === 'stop') { running = false; return }
      const load = e.data.load / 100
      const cycleMs = 100
      const workMs = cycleMs * load
      function work() {
        if (!running) return
        const start = Date.now()
        while (Date.now() - start < workMs) {
          Math.sqrt(Math.random() * 999999)
        }
        const elapsed = Date.now() - start
        const rest = Math.max(0, cycleMs - elapsed)
        setTimeout(work, rest)
      }
      work()
    }
  `
  const blob = new Blob([workerCode], { type: 'application/javascript' })
  cpuWorkerUrl = URL.createObjectURL(blob)

  const coreCount = navigator.hardwareConcurrency || 4
  for (let i = 0; i < coreCount; i++) {
    const worker = new Worker(cpuWorkerUrl)
    worker.postMessage({ load: loadPercent })
    cpuWorkers.push(worker)
  }
}

function stopCpuStress() {
  cpuWorkers.forEach(w => { try { w.postMessage('stop') } catch (e) {} ; try { w.terminate() } catch (e) {} })
  cpuWorkers = []
  if (cpuWorkerUrl) {
    URL.revokeObjectURL(cpuWorkerUrl)
    cpuWorkerUrl = null
  }
}

// ── GPU Stres (WebGL) ────────────────────────────────────────────
let glProgram = null
let glContext = null

function startGpuStress(loadPercent) {
  const canvas = document.getElementById('glCanvas')
  // A large drawing buffer means far more fragment-shader invocations per draw.
  // (The old 512² canvas + a light shader barely touched a modern GPU.)
  canvas.width = 1024
  canvas.height = 1024
  // Make it a small VISIBLE canvas while the test runs. A hidden (display:none)
  // canvas isn't composited, and Chromium throttles requestAnimationFrame for a
  // window it considers occluded — both of which left the GPU nearly idle. A
  // visible, animating canvas keeps rAF at full rate and forces the pipeline.
  canvas.style.cssText = 'position:fixed;right:10px;bottom:10px;width:96px;height:96px;border-radius:8px;border:1px solid var(--border-input);z-index:20;display:block'
  // powerPreference:'high-performance' asks the browser for the discrete GPU on
  // hybrid-graphics machines, so the stress actually lands on the NVIDIA card.
  const glOpts = { powerPreference: 'high-performance', antialias: false, preserveDrawingBuffer: false }
  const gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts)
  if (!gl) return
  glContext = gl

  const vs = `attribute vec4 p; void main(){ gl_Position = p; }`
  // Per-pixel workload. The loop bound is kept SMALL and constant: on Windows
  // WebGL runs on ANGLE/Direct3D, which unrolls loops — a large bound (e.g. 480)
  // blew past the shader instruction limit so it failed to compile and nothing
  // ran at all. We keep the shader cheap-to-compile and scale the real load with
  // the number of draws per frame instead (see drawsPerFrame below).
  const fs = `
    precision highp float;
    uniform float uTime;
    uniform float uIter;
    void main(){
      vec2 uv = gl_FragCoord.xy / 1024.0;
      vec2 c = (uv - 0.5) * 3.0;
      vec2 z = vec2(0.0);
      float v = 0.0;
      for(float i = 0.0; i < 64.0; i++){
        if(i >= uIter) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        v += sin(z.x * 3.14159 + uTime) * cos(z.y * 3.14159 - uTime);
      }
      gl_FragColor = vec4(abs(sin(v)), abs(cos(v)), abs(sin(v+uTime)), 1.0);
    }
  `

  const compile = (type, src, label) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[gpu-stress] ' + label + ' shader compile failed:', gl.getShaderInfoLog(s))
    }
    return s
  }

  glProgram = gl.createProgram()
  gl.attachShader(glProgram, compile(gl.VERTEX_SHADER, vs, 'vertex'))
  gl.attachShader(glProgram, compile(gl.FRAGMENT_SHADER, fs, 'fragment'))
  gl.linkProgram(glProgram)
  if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
    console.error('[gpu-stress] program link failed:', gl.getProgramInfoLog(glProgram))
  }
  gl.useProgram(glProgram)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
  const pos = gl.getAttribLocation(glProgram, 'p')
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
  gl.viewport(0, 0, canvas.width, canvas.height)

  const uTime = gl.getUniformLocation(glProgram, 'uTime')
  const uIter = gl.getUniformLocation(glProgram, 'uIter')

  let t = 0
  const frac = Math.max(0.05, Math.min(1, loadPercent / 100))
  // Real load comes mostly from MANY draws per frame of a full-screen 1024² pass
  // (a safe-to-compile shader). Draw count scales with the chosen level.
  const iterCount = Math.max(16, Math.round(frac * 64))
  const drawsPerFrame = Math.max(2, Math.round(frac * 64))
  const pixel = new Uint8Array(4) // scratch for the forcing readPixels

  function render() {
    if (!isRunning) return
    t += 0.03
    gl.uniform1f(uTime, t)
    gl.uniform1f(uIter, iterCount)
    for (let d = 0; d < drawsPerFrame; d++) {
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    // Force the GPU to actually finish all those draws before the frame ends.
    // readPixels blocks until the queued work completes, which both guarantees
    // the shader runs and creates back-pressure that keeps the GPU continuously
    // busy (instead of racing ahead and idling until the next vsync).
    try { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel) } catch (e) {}
    gpuAnimFrame = requestAnimationFrame(render)
  }
  render()
}

function stopGpuStress() {
  if (gpuAnimFrame) cancelAnimationFrame(gpuAnimFrame)
  gpuAnimFrame = null
  const canvas = document.getElementById('glCanvas')
  if (canvas) canvas.style.display = 'none' // hide the live preview again
  // Free WebGL resources to prevent context leaks across runs.
  if (glContext) {
    try {
      const lose = glContext.getExtension('WEBGL_lose_context')
      if (lose) lose.loseContext()
    } catch (e) {}
  }
  glProgram = null
  glContext = null
}

// ── Grafikler ────────────────────────────────────────────────────
function initCharts() {
  const isDark = !document.body.classList.contains('light')
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
  const textColor = isDark ? '#64748b' : '#94a3b8'

  const opts = (yMax) => ({
    responsive: true, animation: false,
    plugins: { legend: { labels: { color: textColor, boxWidth: 10, font: { size: 10 } } } },
    scales: {
      x: { display: false },
      y: { min: 0, max: yMax, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } }
    },
    elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 2 } }
  })

  if (loadChart) loadChart.destroy()
  if (tempChart) tempChart.destroy()

  const datasets = []
  if (selectedType !== 'gpu') datasets.push({ label: 'CPU %', borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, data: [] })
  if (selectedType !== 'cpu') datasets.push({ label: 'GPU %', borderColor: '#ec4899', backgroundColor: 'rgba(236,72,153,0.1)', fill: true, data: [] })

  const tempDatasets = []
  if (selectedType !== 'gpu') tempDatasets.push({ label: 'CPU °C', borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', fill: true, data: [] })
  if (selectedType !== 'cpu') tempDatasets.push({ label: 'GPU °C', borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, data: [] })

  loadChart = new Chart(document.getElementById('loadChart'), { type: 'line', data: { labels: [], datasets }, options: opts(100) })
  tempChart = new Chart(document.getElementById('tempChart'), { type: 'line', data: { labels: [], datasets: tempDatasets }, options: opts(120) })
}

// ── Min/Max/Avg ──────────────────────────────────────────────────
function calcStats(arr) {
  const f = arr.filter(v => v !== null && v !== undefined && !isNaN(v))
  if (!f.length) return { min: null, max: null, avg: null }
  return {
    min: Math.round(Math.min(...f)),
    max: Math.round(Math.max(...f)),
    avg: Math.round(f.reduce((a, b) => a + b, 0) / f.length)
  }
}

function fmt(val, unit) { return val !== null && val !== undefined ? `${val}${unit}` : '—' }

function setLiveVal(id, val, unit) {
  const el = document.getElementById(id)
  if (el) el.childNodes[0].textContent = val !== null ? `${typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(1) : val}` : '—'
}

function setLiveSub(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

// ── Canlı güncelleme ─────────────────────────────────────────────
function updateLiveUI(sample) {
  const cpuLoads = samples.map(s => s.cpu.load)
  const cpuTemps = samples.map(s => s.cpu.temp)
  const gpuLoads = samples.map(s => s.gpu.load)
  const gpuTemps = samples.map(s => s.gpu.temp)
  const gpuPowers = samples.map(s => s.gpu.power)

  const cLS = calcStats(cpuLoads), cTS = calcStats(cpuTemps)
  const gLS = calcStats(gpuLoads), gTS = calcStats(gpuTemps), gPS = calcStats(gpuPowers)

  if (selectedType !== 'gpu') {
    setLiveVal('liveCpuLoad', sample.cpu.load, '%')
    setLiveSub('liveCpuLoadMM', `min ${fmt(cLS.min, '%')} / max ${fmt(cLS.max, '%')}`)
    setLiveVal('liveCpuTemp', sample.cpu.temp, '°C')
    setLiveSub('liveCpuTempMM', `min ${fmt(cTS.min, '°C')} / max ${fmt(cTS.max, '°C')}`)
  }

  if (selectedType !== 'cpu') {
    setLiveVal('liveGpuLoad', sample.gpu.load, '%')
    setLiveSub('liveGpuLoadMM', `min ${fmt(gLS.min, '%')} / max ${fmt(gLS.max, '%')}`)
    setLiveVal('liveGpuTemp', sample.gpu.temp, '°C')
    setLiveSub('liveGpuTempMM', `min ${fmt(gTS.min, '°C')} / max ${fmt(gTS.max, '°C')}`)
    const powerEl = document.getElementById('liveGpuPower')
    if (powerEl) powerEl.childNodes[0].textContent = sample.gpu.power !== null ? sample.gpu.power.toFixed(1) : '—'
    setLiveSub('liveGpuPowerMM', `min ${fmt(gPS.min, 'W')} / max ${fmt(gPS.max, 'W')}`)
    setLiveVal('liveGpuVram', sample.gpu.vramUsed, '')
    setLiveSub('liveGpuVramTotal', `/ ${fmt(sample.gpu.vramTotal, ' MB total')}`)
  }

  // Grafik
  const label = new Date(sample.timestamp).toLocaleTimeString()
  const MAX = 120

  if (loadChart) {
    loadChart.data.labels.push(label)
    let di = 0
    if (selectedType !== 'gpu') loadChart.data.datasets[di++].data.push(sample.cpu.load)
    if (selectedType !== 'cpu') loadChart.data.datasets[di].data.push(sample.gpu.load)
    if (loadChart.data.labels.length > MAX) {
      loadChart.data.labels.shift()
      loadChart.data.datasets.forEach(d => d.data.shift())
    }
    loadChart.update()
  }

  if (tempChart) {
    tempChart.data.labels.push(label)
    let di = 0
    if (selectedType !== 'gpu') tempChart.data.datasets[di++].data.push(sample.cpu.temp)
    if (selectedType !== 'cpu') tempChart.data.datasets[di].data.push(sample.gpu.temp)
    if (tempChart.data.labels.length > MAX) {
      tempChart.data.labels.shift()
      tempChart.data.datasets.forEach(d => d.data.shift())
    }
    tempChart.update()
  }
}

// ── Verdict ──────────────────────────────────────────────────────
function getVerdict(avgTemp, maxTemp, type) {
  if (maxTemp === null) return { cls: 'good', text: 'No temperature sensor data available.' }
  if (type === 'cpu') {
    if (maxTemp >= 95) return { cls: 'danger', text: `Critical: CPU peaked at ${maxTemp}°C. Check cooling immediately. Possible thermal throttling.` }
    if (maxTemp >= 85) return { cls: 'warn', text: `Warning: CPU reached ${maxTemp}°C. Consider improving airflow or reapplying thermal paste.` }
    if (maxTemp >= 75) return { cls: 'warn', text: `Warm: CPU reached ${maxTemp}°C. Acceptable but monitor under extended loads.` }
    return { cls: 'good', text: `Healthy: CPU temperatures are within safe range. Peak: ${maxTemp}°C, Avg: ${avgTemp}°C.` }
  } else {
    if (maxTemp >= 90) return { cls: 'danger', text: `Critical: GPU peaked at ${maxTemp}°C. Improve case airflow urgently.` }
    if (maxTemp >= 80) return { cls: 'warn', text: `Warning: GPU reached ${maxTemp}°C. Clean GPU fans or reapply thermal paste.` }
    if (maxTemp >= 70) return { cls: 'warn', text: `Warm: GPU reached ${maxTemp}°C. Acceptable for most GPUs under load.` }
    return { cls: 'good', text: `Healthy: GPU temperatures are within safe range. Peak: ${maxTemp}°C, Avg: ${avgTemp}°C.` }
  }
}

// ── Rapor ────────────────────────────────────────────────────────
function showReport() {
  const report = document.getElementById('reportSection')
  document.getElementById('progressSection').classList.remove('visible')
  report.classList.add('visible')

  // Safety-cutoff banner (shown only when the thermal limit stopped the test).
  const existing = document.getElementById('safetyBanner')
  if (existing) existing.remove()
  if (safetyTripped) {
    const banner = document.createElement('div')
    banner.id = 'safetyBanner'
    banner.style.cssText = 'background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#fecaca;line-height:1.4'
    banner.textContent = '⚠ Test güvenlik için otomatik durduruldu — sıcaklık kritik eşiği aştı (CPU ≥ ' +
      SAFETY_CPU_TEMP + '°C veya GPU ≥ ' + SAFETY_GPU_TEMP + '°C). Soğutmanı kontrol et.'
    report.insertBefore(banner, report.firstChild)
  }

  const cLS = calcStats(samples.map(s => s.cpu.load))
  const cTS = calcStats(samples.map(s => s.cpu.temp))
  const gLS = calcStats(samples.map(s => s.gpu.load))
  const gTS = calcStats(samples.map(s => s.gpu.temp))
  const gPS = calcStats(samples.map(s => s.gpu.power))

  const cpuCard = document.getElementById('cpuReportCard')
  cpuCard.style.display = selectedType !== 'gpu' ? 'block' : 'none'
  if (selectedType !== 'gpu') {
    document.getElementById('rCpuAvgLoad').textContent = fmt(cLS.avg, '%')
    document.getElementById('rCpuMaxLoad').textContent = fmt(cLS.max, '%')
    document.getElementById('rCpuMinLoad').textContent = fmt(cLS.min, '%')
    document.getElementById('rCpuAvgTemp').textContent = fmt(cTS.avg, '°C')
    document.getElementById('rCpuMaxTemp').textContent = fmt(cTS.max, '°C')
    document.getElementById('rCpuMinTemp').textContent = fmt(cTS.min, '°C')
    const cv = getVerdict(cTS.avg, cTS.max, 'cpu')
    const cpuV = document.getElementById('cpuVerdict')
    cpuV.className = `verdict ${cv.cls}`
    cpuV.textContent = cv.text
  }

  const gpuCard = document.getElementById('gpuReportCard')
  gpuCard.style.display = selectedType !== 'cpu' ? 'block' : 'none'
  if (selectedType !== 'cpu') {
    document.getElementById('rGpuAvgLoad').textContent = fmt(gLS.avg, '%')
    document.getElementById('rGpuMaxLoad').textContent = fmt(gLS.max, '%')
    document.getElementById('rGpuAvgTemp').textContent = fmt(gTS.avg, '°C')
    document.getElementById('rGpuMaxTemp').textContent = fmt(gTS.max, '°C')
    document.getElementById('rGpuAvgPower').textContent = gPS.avg !== null ? `${gPS.avg}W` : '—'
    document.getElementById('rGpuMaxPower').textContent = gPS.max !== null ? `${gPS.max}W` : '—'
    const gv = getVerdict(gTS.avg, gTS.max, 'gpu')
    const gpuV = document.getElementById('gpuVerdict')
    gpuV.className = `verdict ${gv.cls}`
    gpuV.textContent = gv.text
  }

  const labels = samples.map((_, i) => {
    const secs = i * 5
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  })

  const rLoadDatasets = []
  if (selectedType !== 'gpu') rLoadDatasets.push({ label: 'CPU %', borderColor: '#3b82f6', data: samples.map(s => s.cpu.load), borderWidth: 2, pointRadius: 0, tension: 0.3 })
  if (selectedType !== 'cpu') rLoadDatasets.push({ label: 'GPU %', borderColor: '#ec4899', data: samples.map(s => s.gpu.load), borderWidth: 2, pointRadius: 0, tension: 0.3 })

  const rTempDatasets = []
  if (selectedType !== 'gpu') rTempDatasets.push({ label: 'CPU °C', borderColor: '#f97316', data: samples.map(s => s.cpu.temp), borderWidth: 2, pointRadius: 0, tension: 0.3 })
  if (selectedType !== 'cpu') rTempDatasets.push({ label: 'GPU °C', borderColor: '#ef4444', data: samples.map(s => s.gpu.temp), borderWidth: 2, pointRadius: 0, tension: 0.3 })

  new Chart(document.getElementById('reportLoadChart'), {
    type: 'line',
    data: { labels, datasets: rLoadDatasets },
    options: { responsive: true, animation: false, plugins: { legend: { labels: { font: { size: 10 }, boxWidth: 10 } } }, scales: { x: { display: false }, y: { min: 0, max: 100 } } }
  })

  new Chart(document.getElementById('reportTempChart'), {
    type: 'line',
    data: { labels, datasets: rTempDatasets },
    options: { responsive: true, animation: false, plugins: { legend: { labels: { font: { size: 10 }, boxWidth: 10 } } }, scales: { x: { display: false }, y: { min: 0, max: 120 } } }
  })

  if (typeof lucide !== 'undefined') lucide.createIcons()
}

// ── Başlat ───────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
  if (isRunning) return
  isRunning = true
  safetyTripped = false
  samples = []
  startTime = Date.now()

  document.getElementById('setupSection').style.display = 'none'
  document.getElementById('progressSection').classList.add('visible')
  document.getElementById('reportSection').classList.remove('visible')

  document.getElementById('cpuLiveSection').style.display = selectedType !== 'gpu' ? 'block' : 'none'
  document.getElementById('gpuLiveSection').style.display = selectedType !== 'cpu' ? 'block' : 'none'

  const badges = document.getElementById('activeBadges')
  badges.innerHTML = ''
  if (selectedType !== 'gpu') badges.innerHTML += `<span class="stress-badge">CPU ${selectedLoad}%</span>`
  if (selectedType !== 'cpu') badges.innerHTML += `<span class="stress-badge">GPU ${selectedLoad}%</span>`

  initCharts()

  if (selectedType !== 'gpu') startCpuStress(selectedLoad)
  if (selectedType !== 'cpu') startGpuStress(selectedLoad)

  benchmarkInterval = setInterval(async () => {
    const sample = await api.invoke('get-benchmark-sample')
    if (sample) {
      samples.push(sample)
      if (samples.length > MAX_SAMPLES) samples.shift()
      updateLiveUI(sample)
      // Thermal safety net: stop the test at once if a temperature gets dangerous.
      const ct = sample.cpu.temp, gt = sample.gpu.temp
      if ((ct != null && ct >= SAFETY_CPU_TEMP) || (gt != null && gt >= SAFETY_GPU_TEMP)) {
        safetyTripped = true
        stopBenchmark(true)
      }
    }
  }, 5000)

  progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime
    const pct = Math.min((elapsed / selectedDuration) * 100, 100)
    document.getElementById('progressBar').style.width = `${pct}%`
    const remaining = Math.max(0, selectedDuration - elapsed)
    const mins = Math.floor(remaining / 60000)
    const secs = Math.floor((remaining % 60000) / 1000)
    document.getElementById('timeLeft').textContent = `${mins}:${secs.toString().padStart(2, '0')} remaining`
    if (elapsed >= selectedDuration) stopBenchmark(true)
  }, 1000)
})

function stopBenchmark(finished = false) {
  clearInterval(benchmarkInterval)
  clearInterval(progressInterval)
  benchmarkInterval = null
  progressInterval = null
  stopCpuStress()
  stopGpuStress()
  isRunning = false

  if (samples.length > 0) {
    showReport()
  } else {
    document.getElementById('setupSection').style.display = 'block'
    document.getElementById('progressSection').classList.remove('visible')
  }
}

document.getElementById('stopBtn').addEventListener('click', () => stopBenchmark(false))

document.getElementById('newBenchmarkBtn').addEventListener('click', () => {
  document.getElementById('setupSection').style.display = 'block'
  document.getElementById('progressSection').classList.remove('visible')
  document.getElementById('reportSection').classList.remove('visible')
  if (loadChart) { loadChart.destroy(); loadChart = null }
  if (tempChart) { tempChart.destroy(); tempChart = null }
})

// ── Kaydet ───────────────────────────────────────────────────────
document.getElementById('saveReportBtn').addEventListener('click', async () => {
  const report = {
    date: new Date().toISOString(),
    testType: selectedType,
    loadLevel: `${selectedLoad}%`,
    duration: `${selectedDuration / 60000} minutes`,
    sampleCount: samples.length,
    cpu: selectedType !== 'gpu' ? {
      load: calcStats(samples.map(s => s.cpu.load)),
      temperature: calcStats(samples.map(s => s.cpu.temp))
    } : null,
    gpu: selectedType !== 'cpu' ? {
      load: calcStats(samples.map(s => s.gpu.load)),
      temperature: calcStats(samples.map(s => s.gpu.temp)),
      power: calcStats(samples.map(s => s.gpu.power))
    } : null,
    rawSamples: samples
  }

  const filename = `stress-benchmark-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
  const btn = document.getElementById('saveReportBtn')
  const original = btn.textContent
  const flash = (text) => {
    btn.textContent = text
    setTimeout(() => { btn.textContent = original }, 2000)
  }
  try {
    const res = await api.invoke('save-benchmark-report', { filename, content: JSON.stringify(report, null, 2) })
    if (res && res.ok) flash('✓ Saved')
    else if (res && res.canceled) { /* user dismissed the dialog — leave the button as-is */ }
    else flash('✕ Save failed')
  } catch (e) {
    console.error('Save failed:', e)
    flash('✕ Save failed')
  }
})

document.getElementById('closeBtn').addEventListener('click', () => {
  // Tear down directly instead of calling stopBenchmark(): stopBenchmark switches
  // to the report view (and builds charts) when samples exist, which is both the
  // wrong thing to do while closing and a step that, if it threw, would keep the
  // close-benchmark message from ever being sent — leaving the window stuck open.
  try {
    clearInterval(benchmarkInterval)
    clearInterval(progressInterval)
    stopCpuStress()
    stopGpuStress()
  } catch (e) { /* close no matter what */ }
  isRunning = false
  api.send('close-benchmark')
})

// Make sure we tear everything down if the user closes the window or navigates.
window.addEventListener('beforeunload', () => {
  if (isRunning) stopBenchmark(false)
  stopCpuStress()
  stopGpuStress()
  if (loadChart) { try { loadChart.destroy() } catch (e) {} ; loadChart = null }
  if (tempChart) { try { tempChart.destroy() } catch (e) {} ; tempChart = null }
})

})()
