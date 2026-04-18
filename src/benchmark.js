const { ipcRenderer, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ── State ────────────────────────────────────────────────────────
let selectedType = 'both'
let selectedLoad = 75
let selectedDuration = 5 * 60 * 1000
let isRunning = false
let startTime = null
let samples = []
let benchmarkInterval = null
let progressInterval = null
let cpuWorkers = []
let gpuAnimFrame = null
let loadChart = null
let tempChart = null

// ── Tema ────────────────────────────────────────────────────────
async function initTheme() {
  const theme = await ipcRenderer.invoke('get-theme')
  document.body.classList.toggle('light', theme === 'light')
}
ipcRenderer.on('theme-changed', (_, theme) => document.body.classList.toggle('light', theme === 'light'))
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
      selectedLoad = parseInt(document.getElementById('customLoadRange').value)
    } else {
      document.getElementById('customLoadSection').style.display = 'none'
      selectedLoad = parseInt(btn.dataset.load)
    }
  })
})

document.getElementById('customLoadRange').addEventListener('input', (e) => {
  selectedLoad = parseInt(e.target.value)
  document.getElementById('customLoadVal').textContent = `${selectedLoad}%`
})

// ── Süre seçimi ──────────────────────────────────────────────────
document.querySelectorAll('[data-min]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-min]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedDuration = parseInt(btn.dataset.min) * 60 * 1000
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
  const url = URL.createObjectURL(blob)

  const coreCount = navigator.hardwareConcurrency || 4
  for (let i = 0; i < coreCount; i++) {
    const worker = new Worker(url)
    worker.postMessage({ load: loadPercent })
    cpuWorkers.push(worker)
  }
}

function stopCpuStress() {
  cpuWorkers.forEach(w => { w.postMessage('stop'); w.terminate() })
  cpuWorkers = []
}

// ── GPU Stres (WebGL) ────────────────────────────────────────────
let glProgram = null
let glContext = null

function startGpuStress(loadPercent) {
  const canvas = document.getElementById('glCanvas')
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
  if (!gl) return
  glContext = gl

  const vs = `attribute vec4 p; void main(){ gl_Position = p; }`
  const fs = `
    precision highp float;
    uniform float uTime;
    uniform float uLoad;
    void main(){
      vec2 uv = gl_FragCoord.xy / 512.0;
      float v = 0.0;
      float iter = uLoad * 50.0;
      for(float i = 0.0; i < 50.0; i++){
        if(i >= iter) break;
        v += sin(uv.x * (i+1.0) * 3.14 + uTime) * cos(uv.y * (i+1.0) * 3.14 - uTime);
      }
      gl_FragColor = vec4(abs(sin(v)), abs(cos(v)), abs(sin(v+uTime)), 1.0);
    }
  `

  const compile = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }

  glProgram = gl.createProgram()
  gl.attachShader(glProgram, compile(gl.VERTEX_SHADER, vs))
  gl.attachShader(glProgram, compile(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(glProgram)
  gl.useProgram(glProgram)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
  const pos = gl.getAttribLocation(glProgram, 'p')
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

  const uTime = gl.getUniformLocation(glProgram, 'uTime')
  const uLoad = gl.getUniformLocation(glProgram, 'uLoad')

  let t = 0
  const frameInterval = Math.max(1, Math.round((1 - loadPercent / 100) * 60))
  let frameCount = 0

  function render() {
    if (!isRunning) return
    frameCount++
    if (frameCount % Math.max(1, frameInterval) === 0 || loadPercent >= 90) {
      t += 0.05
      gl.uniform1f(uTime, t)
      gl.uniform1f(uLoad, loadPercent / 100)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    gpuAnimFrame = requestAnimationFrame(render)
  }
  render()
}

function stopGpuStress() {
  if (gpuAnimFrame) cancelAnimationFrame(gpuAnimFrame)
  gpuAnimFrame = null
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
    if (maxTemp >= 95) return { cls: 'danger', text: `🔴 Critical: CPU peaked at ${maxTemp}°C. Check cooling immediately. Possible thermal throttling.` }
    if (maxTemp >= 85) return { cls: 'warn', text: `🟡 Warning: CPU reached ${maxTemp}°C. Consider improving airflow or reapplying thermal paste.` }
    if (maxTemp >= 75) return { cls: 'warn', text: `🟡 Warm: CPU reached ${maxTemp}°C. Acceptable but monitor under extended loads.` }
    return { cls: 'good', text: `🟢 Healthy: CPU temperatures are within safe range. Peak: ${maxTemp}°C, Avg: ${avgTemp}°C.` }
  } else {
    if (maxTemp >= 90) return { cls: 'danger', text: `🔴 Critical: GPU peaked at ${maxTemp}°C. Improve case airflow urgently.` }
    if (maxTemp >= 80) return { cls: 'warn', text: `🟡 Warning: GPU reached ${maxTemp}°C. Clean GPU fans or reapply thermal paste.` }
    if (maxTemp >= 70) return { cls: 'warn', text: `🟡 Warm: GPU reached ${maxTemp}°C. Acceptable for most GPUs under load.` }
    return { cls: 'good', text: `🟢 Healthy: GPU temperatures are within safe range. Peak: ${maxTemp}°C, Avg: ${avgTemp}°C.` }
  }
}

// ── Rapor ────────────────────────────────────────────────────────
function showReport() {
  document.getElementById('progressSection').classList.remove('visible')
  document.getElementById('reportSection').classList.add('visible')

  const cLS = calcStats(samples.map(s => s.cpu.load))
  const cTS = calcStats(samples.map(s => s.cpu.temp))
  const gLS = calcStats(samples.map(s => s.gpu.load))
  const gTS = calcStats(samples.map(s => s.gpu.temp))
  const gPS = calcStats(samples.map(s => s.gpu.power))

  // CPU raporu
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

  // GPU raporu
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

  // Rapor grafikleri
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

  lucide.createIcons()
}

// ── Başlat ───────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
  if (isRunning) return
  isRunning = true
  samples = []
  startTime = Date.now()

  document.getElementById('setupSection').style.display = 'none'
  document.getElementById('progressSection').classList.add('visible')
  document.getElementById('reportSection').classList.remove('visible')

  // Live section görünürlüğü
  document.getElementById('cpuLiveSection').style.display = selectedType !== 'gpu' ? 'block' : 'none'
  document.getElementById('gpuLiveSection').style.display = selectedType !== 'cpu' ? 'block' : 'none'

  // Badge'ler
  const badges = document.getElementById('activeBadges')
  badges.innerHTML = ''
  if (selectedType !== 'gpu') badges.innerHTML += `<span class="stress-badge">💻 CPU ${selectedLoad}%</span>`
  if (selectedType !== 'cpu') badges.innerHTML += `<span class="stress-badge">🎮 GPU ${selectedLoad}%</span>`

  initCharts()

  // Stres başlat
  if (selectedType !== 'gpu') startCpuStress(selectedLoad)
  if (selectedType !== 'cpu') startGpuStress(selectedLoad)

  // Örnek topla
  benchmarkInterval = setInterval(async () => {
    const sample = await ipcRenderer.invoke('get-benchmark-sample')
    if (sample) { samples.push(sample); updateLiveUI(sample) }
  }, 5000)

  // Progress
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
document.getElementById('saveReportBtn').addEventListener('click', () => {
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

  const fileName = `stress-benchmark-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
  const filePath = path.join(os.homedir(), 'Desktop', fileName)
  try {
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2))
    shell.showItemInFolder(filePath)
  } catch (e) { console.error('Save failed:', e) }
})

document.getElementById('closeBtn').addEventListener('click', () => {
  if (isRunning) stopBenchmark(false)
  ipcRenderer.send('close-benchmark')
})