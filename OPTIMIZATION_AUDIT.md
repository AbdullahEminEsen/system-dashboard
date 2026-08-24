# System Dashboard — Optimization Audit

**Project:** `system-dashboard` v1.2.3 (Electron 28 desktop widget)
**Date:** 2026-04-27
**Scope:** Runtime performance, code quality / refactor, security & best practices
**Method:** Full read of `src/*.js` and `src/*.html` plus `package.json`, with line-level verification of the highest-impact findings.

This report identifies issues only — no source files have been modified. Every finding points to a file and line so it can be acted on directly.

---

## 1. Top 10 highest-impact issues

Ranked by overall payoff (severity × ease of fixing). Severity follows the convention Critical / High / Medium / Low. Effort: S = under an hour, M = a few hours, L = half-day or more.

### #1 — `nodeIntegration: true` and `contextIsolation: false` on every window
**Severity:** Critical · **Category:** Security · **Effort:** M
**Location:** `src/main.js:66, 170, 185, 206`

All four `BrowserWindow` instances (main, editor, settings, benchmark) are created with the same `webPreferences`:
```js
webPreferences: { nodeIntegration: true, contextIsolation: false }
```
There is no `preload` script and no `sandbox: true`. This is the Electron security model from ~2018 and is the configuration the official Electron security checklist warns against most strongly. Any HTML injection — for example via the city dropdown which writes `innerHTML` from a fetched API response (`src/renderer.js:474–516`) — would give an attacker direct `require()` access to Node, the filesystem, `child_process`, and the user's `electron-store` data.

**Fix:** Add `src/preload.js` that uses `contextBridge.exposeInMainWorld('api', { ... })` to expose only the IPC channels you actually need. Set `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every window. Replace direct `require('electron')` calls in renderer files with `window.api.*`. This is the highest-value change in the entire codebase.

### #2 — Full DOM rebuild every 4 seconds with no diffing
**Severity:** High · **Category:** Performance · **Effort:** M
**Location:** `src/renderer.js:300–356` (the `system-update` IPC handler)

Every push from `pushSystemData()` (`src/main.js:235`, fires every 4 s) triggers ~15 `innerHTML` / `textContent` writes across the widget. On an always-on widget pinned over the desktop this re-paints the window 21,600 times an hour, regardless of whether values changed. On laptops this is measurable battery drain, and the GPU process keeps the discrete GPU awake on hybrid systems.

**Fix:** Cache the previous `data` payload, diff per-key, and only update DOM nodes whose values changed. Wrap the writes in a single `requestAnimationFrame` so multiple changes coalesce. This alone typically cuts CPU time of always-on Electron widgets by 30–50%.

### #3 — Listeners and `lucide.createIcons()` re-attached on every layout render
**Severity:** High · **Category:** Performance / Memory · **Effort:** M
**Location:** `src/renderer.js:249–283, 452–526, 559–565`

`renderLayout()` clears `innerHTML` and then calls `initWeatherListeners()`, `initSelectListeners()`, and `initBenchmarkListeners()`, each of which adds new `addEventListener` calls without removing the old ones. The function is called on layout change, visibility change, and language change. `lucide.createIcons()` is invoked 7+ times in the same paths — each call walks the full DOM looking for `data-lucide` attributes and replaces them with SVG.

**Fix:** Use one event-delegation listener attached to the widget root in `DOMContentLoaded` and switch on `e.target.dataset.action`. Call `lucide.createIcons()` once after the initial render and once after each `renderLayout()` — not inside helper init functions. This removes the listener-leak and the repeat icon parse.

### #4 — IPC handlers accept untrusted renderer input without validation
**Severity:** High · **Category:** Security · **Effort:** S
**Location:** `src/main.js:378–457` (every `ipcMain.on(...)` and `ipcMain.handle(...)`)

Once finding #1 is fixed, the renderer is no longer fully trusted, and IPC becomes the trust boundary. None of the handlers validate input: `set-city` takes any string (later interpolated into a URL), `set-opacity` / `set-layout` / `set-card-visibility` accept any shape, and there is no rate-limiting. Even before fixing #1, a compromised npm dependency in any renderer can call these handlers freely.

**Fix:** Add a thin validator at the top of each handler — type, length, enum, range — and drop or log out-of-spec calls. For `set-city`, also validate against a whitelist of characters before passing to `axios.get(...)`. Consider using `ipcMain.handle` everywhere (not `on`) so failures can be returned to the renderer.

### #5 — External HTTP calls have no timeout and no dedup
**Severity:** High · **Category:** Performance / Reliability · **Effort:** S
**Location:** `src/main.js:354, 362` (axios) and `src/renderer.js:481` (fetch)

`axios.get(...)` to open-meteo geocoding/forecast and the renderer's `fetch(...)` for city autocomplete are called with no `timeout`, no `signal`, and no dedup. If the API hangs or the user has a flaky connection, the geocoding request can sit forever holding sockets; the city input fires on every keystroke (350 ms debounce) but in-flight requests are never aborted, so rapid typing creates a backlog and the *last* request to resolve wins (race condition) rather than the request matching the most recent input.

**Fix:** Pass `{ timeout: 8000 }` to axios. Use `AbortController` on the renderer's `fetch` and abort the previous request before issuing the next. Cache geocoding results by lowercase city name for 1 hour.

### #6 — `updateTempBg()` is a no-op; CPU temperature is always `null`
**Severity:** Medium · **Category:** Code Quality (real bug) · **Effort:** S
**Location:** `src/main.js:299–301`, also `458–460`, sent from `:343`

```js
async function updateTempBg() {
  cachedCpuTemp = null
}
```
This stub is scheduled every 60 seconds (`src/main.js:317`), and the value is sent on every push (`cpuTemp: cachedCpuTemp ?? null`, line 343). The result is that a feature visible in the README ("CPU temperature") is silently dead in the main code path. Separately, `getCpuTempFallback()` (line 458) is reached from the alternative path on line 468 but unconditionally `return null`, so even that fallback contributes nothing.

**Fix:** Implement `updateTempBg` as `cachedCpuTemp = (await si.cpuTemperature()).main ?? null` inside try/catch, then either remove `getCpuTempFallback()` or actually fall back to a platform read (e.g., `wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature` on Windows, `sensors` on Linux).

### #7 — Polling cadence is misaligned with cache TTLs, causing jitter
**Severity:** Medium · **Category:** Performance · **Effort:** S
**Location:** `src/main.js:312–317` and the 4 s push interval at `:235`

The push runs every 4 s but the cache TTLs are 10 s / 15 s / 25 s / 45 s / 90 s. Because none are integer multiples of 4, the "should I refresh?" check fires at irregular pushes and a single push can trigger several `queueBg(...)` updates simultaneously, which then race against the synchronous `await si.currentLoad()` on the next tick.

**Fix:** Either pick TTLs that are multiples of the push interval (e.g., 8 / 16 / 24 / 48 / 96 s) or — better — give each metric its own `setInterval` so the push handler is a pure read of cached state. The benchmarks for `systeminformation` get worse the more concurrent `si.*()` calls are in flight; serializing helps.

### #8 — Benchmark window leaks Blob URL, WebGL context, and chart instances
**Severity:** Medium · **Category:** Performance · **Effort:** S
**Location:** `src/benchmark.js:108–177, 195–196, 410–426`

The CPU stress test creates a `Blob` worker via `URL.createObjectURL(...)` but never `URL.revokeObjectURL(...)`. The WebGL context (`glContext`) and `gpuAnimFrame` are stored module-globally and may not be cleaned up if the user closes the benchmark window mid-run. The first `new Chart(...)` is guarded by `chart?.destroy()`, but the report-rendering path constructs new charts unconditionally.

**Fix:** Revoke blob URLs after `new Worker(url)`. Add a `window.addEventListener('beforeunload', cleanup)` that terminates workers, cancels `requestAnimationFrame`, loses the WebGL context (`gl.getExtension('WEBGL_lose_context')?.loseContext()`), and destroys all chart instances.

### #9 — Unbounded benchmark `samples` array
**Severity:** Medium · **Category:** Performance · **Effort:** S
**Location:** `src/benchmark.js:12, 410–413`

`samples` accumulates indefinitely while the benchmark runs. At a 5 s sample rate this is fine for a 5-minute run, but there is no upper bound and no clear-on-restart, so a user who starts/stops/restarts without closing the window grows the array across runs. This also bloats the chart re-render cost.

**Fix:** Reset `samples = []` at the top of `startBenchmark()` and add `if (samples.length >= MAX_SAMPLES) samples.shift()` (e.g., MAX_SAMPLES = 600). Cheap circular buffer would be even better for chart redraws.

### #10 — No CSP and inline `<script>` tags across every HTML file
**Severity:** Medium · **Category:** Security · **Effort:** S–M
**Location:** `src/index.html:7,257`; `src/settings.html:7,295`; `src/editor.html:7–8,253`; `src/benchmark.html:6–7,333`

Every HTML loads dependencies from public CDNs (`unpkg.com/lucide@latest`, `cdn.jsdelivr.net/npm/chart.js`, sortablejs) with no integrity hashes and no Content-Security-Policy. `lucide@latest` in particular pins to the moving "latest" tag — a compromised npm publish would ship straight to your users. There is also an inline `<script>lucide.createIcons()</script>` in each file, so a CSP that locks scripts to `self` will need either `'unsafe-inline'` (defeating the point) or those calls moved into the page's main script file.

**Fix (quick):** Add `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https://geocoding-api.open-meteo.com https://api.open-meteo.com">` to all four HTML files. Move the `lucide.createIcons()` calls into each module's main JS file.
**Fix (proper):** Vendor lucide / chart.js / sortable into `src/vendor/` and load them locally. Eliminates the CDN dependency, the supply-chain risk, and the network call at startup.

---

## 2. Other findings

### Performance

- **Clock loop is its own timer.** `src/renderer.js:297` runs `setInterval(updateClock, 1000)` independently of the system push. Folding it into the existing `system-update` pipeline (or letting main send a per-second `clock-update`) saves one interval and eliminates the chance of clock-vs-data desync. Severity: Low.
- **City dropdown rebuilt with `innerHTML` per keystroke.** `src/renderer.js:474–516` rebuilds the entire dropdown by string concatenation. Use a `DocumentFragment` and `cloneNode` of a `<template>`. Severity: Low.
- **Editor re-renders both lists and re-inits Sortable on every drag.** `src/editor.js:94–197` calls `renderSlotList()` + `renderHiddenPool()` together, and Sortable is re-instantiated rather than its `option('disabled', ...)` toggled. Severity: Low.
- **`set` / `setText` / `setStyle` helpers are redefined inside the `system-update` handler.** `src/renderer.js:301–303` redeclares these closures every 4 s. Move them to module scope. Severity: Low.

### Code quality

- **Magic numbers everywhere.** Cache TTLs (`src/main.js:312–316`), card heights and gaps (`src/renderer.js:20–30`), the 4 s push interval (`src/main.js:235`), and the 350 ms input debounce are all inline literals. Pull them into a `constants.js`. Severity: Low.
- **i18n bypassed in editor strings.** `src/editor.js:123–124, 162–163` hard-code `"Grupla" / "Group"` and `"Ekle" / "Add"` instead of using `i18n.t(...)`. Severity: Low.
- **Silent `try/catch` blocks.** `src/main.js:345, 374, 489` and `src/renderer.js:514` swallow errors. At minimum log to a debug channel that a settings flag can enable. Severity: Low.
- **No types.** No TypeScript and no JSDoc annotations. For a project at this size, even adding `// @ts-check` plus JSDoc on the IPC payloads would catch a lot of real bugs in editor mode. Severity: Low.
- **`getCpuTempFallback()` is misleading.** It's not dead code (line 468 calls it) but it always returns `null`, so its name implies functionality it doesn't have. Either delete or implement. Severity: Low.

### Security

- **Inconsistent IPC verbs.** `src/main.js:378–457` mixes `ipcMain.on` (no return path) with `ipcMain.handle` (Promise return). Standardize on `handle` so callers always get success/failure feedback. Severity: Low.
- **Tray icon failure swallowed.** `src/main.js:119–124` catches a missing icon silently and continues. Log and fall back to a known-good asset. Severity: Low.
- **`dist/` is committed.** Based on `ls`, `dist/` and `node_modules/` exist in the repo. Confirm `.gitignore` excludes both — bundled binaries in git balloon repo size and can leak signing artifacts. (Quick check: `dist/` is 4 KB so it may already be empty/gitignored, but worth confirming.) Severity: Low.

---

## 3. Quick wins (under 30 minutes each)

These are the changes I'd make before lunch on day one — they are all small, low-risk, and individually meaningful.

1. **Add `timeout: 8000` to both axios calls** in `src/main.js:354, 362`. Five minutes, immediately fixes the "geocoding hangs forever" failure mode.
2. **Implement `updateTempBg()` properly** — replace the no-op with `cachedCpuTemp = (await si.cpuTemperature()).main ?? null` in a try/catch. Restores a documented feature.
3. **Add a CSP `<meta>` tag** to all four HTML files (see #10 above). Even with `'unsafe-inline'` for now, it locks `connect-src` so the app can no longer be tricked into calling arbitrary URLs.
4. **Cap and reset `samples`** in `src/benchmark.js`. Two-line change.
5. **Validate `set-city`, `set-opacity`, `set-layout` handlers** in `src/main.js`. Add length/type checks. Twenty minutes, prevents IPC abuse from a compromised renderer.
6. **Move the `set/setText/setStyle` helpers** out of the `system-update` callback to module scope. Trivial.
7. **Replace `lucide@latest` with a pinned version** (`lucide@0.474.0` or whatever is current at the time of fix) in all four HTML files. Stops "latest" from silently shipping a future supply-chain incident.

---

## 4. Architectural recommendations

These are bigger changes — order them after the quick wins.

**Introduce a preload script and turn on contextIsolation.** This is the single change that most improves the security posture of the project. The new `src/preload.js` uses `contextBridge.exposeInMainWorld('api', { onSystemUpdate, getWeather, setCity, setOpacity, setLayout, ... })`. Each renderer file then calls `window.api.*` instead of `require('electron').ipcRenderer.*`. Once that boundary exists, the IPC validation in finding #4 starts to provide real isolation.

**Replace the ad-hoc `cached*` / `last*Update` variables with a `SystemPoller` module.** Today, `src/main.js` has ten module-level variables tracking the cache state of five metrics, plus a hand-written `queueBg` mini-scheduler. Move this into a class:

```js
const poller = new SystemPoller({
  cpu: { fn: () => si.currentLoad(), interval: 4000, timeout: 2000 },
  mem: { fn: () => si.mem(),         interval: 12000, timeout: 2000 },
  gpu: { fn: () => si.graphics(),    interval: 16000, timeout: 3000 },
  // ...
})
poller.on('snapshot', snap => mainWindow.webContents.send('system-update', snap))
poller.start()
```
The class owns its own TTLs, timeouts, error logging, and coalescing — and the main file shrinks by ~150 lines.

**Diff-based rendering in the renderer.** With the change-detection pattern from finding #2, the `system-update` handler becomes a `for…of` over keys whose values differ from the cached snapshot, batched in a single `requestAnimationFrame`. This pairs well with the SystemPoller above because the snapshot becomes a single immutable object that's easy to diff.

**Bundle vendor JS locally.** Run a one-time `npm install lucide chart.js sortablejs` and copy the minified UMD builds into `src/vendor/`. This is a 5-minute change that removes three CDN dependencies and the entire class of "what if unpkg goes down" or "what if `@latest` is poisoned" failure modes.

**Add `electron-builder` `asar` packing and `extraResources`.** The current build config (`package.json` `"build"` block) doesn't enable asar packaging. Asar reduces installer extraction time on Windows and keeps source untouched after install. Just add `"asar": true` under `"build"`.

**Upgrade Electron 28 → latest stable.** Electron 28 is from late 2023 and has known Chromium CVEs that are fixed in 32+. The upgrade should be clean (no major IPC breaking changes between 28 and 32) but test the four windows, the tray, and `requestedExecutionLevel: requireAdministrator` on Windows after the bump.

**Optional: introduce `npm run lint` and `npm run typecheck`.** ESLint with `eslint:recommended` plus `eslint-plugin-electron` would have flagged finding #1 mechanically. Adding `// @ts-check` headers and JSDoc on IPC payloads would have caught the "send a number where a string is expected" class of bugs.

---

## 5. Dependency notes

| Package | Installed | Latest stable (May 2025) | Notes |
|---|---|---|---|
| `electron` | 28.0.0 | 32.x or newer | **Recommended upgrade.** Closes Chromium CVEs accumulated since late 2023. Test plan: launch each window, run benchmark, exercise IPC handlers. |
| `axios` | ^1.6.0 | ^1.7+ | Minor upgrade, no breaking changes. Or drop entirely — Node ≥18 has built-in `fetch` and you only make two GETs. Removing axios saves ~430 KB from the installer. |
| `electron-store` | ^8.2.0 | ^10 (changed to ESM in v9) | Don't upgrade past v8 unless you migrate to ESM imports. Add a `schema` to the constructor to validate stored data shape. |
| `systeminformation` | ^5.21.0 | ^5.23+ | Minor upgrade, fixes some GPU/temp readings on newer hardware. Worth doing alongside the temperature fix in #6. |
| `electron-builder` | ^24.0.0 | ^25 | Optional. v25 has better code-signing support; stay on v24 if signing isn't on the roadmap. |
| **(missing)** | — | — | Add `eslint`, `prettier`, and either TypeScript or `// @ts-check` + `@types/node`/`@types/electron` for editor support. |

`dist/` and `node_modules/` should be in `.gitignore` (the repo currently has both directories present in the working tree — confirm `.gitignore` is excluding them and that they're not tracked in git history).

---

## Suggested order of attack

If you want a single sequence rather than picking and choosing:

1. Quick wins (§3) — half a day, all low-risk.
2. Finding #1 (preload + contextIsolation) — half a day, the security keystone.
3. Finding #4 (IPC validation) — bolts directly onto #1.
4. Finding #2 + #3 (diffed renders, listener cleanup) — half a day, big perf win.
5. Architectural #2 (SystemPoller refactor) — one day.
6. Vendor bundling and Electron upgrade — half a day combined.
7. Lint / typecheck / tests — ongoing.

Total: roughly two to three engineering days to land everything Critical and High, with the runtime-perf and security improvements visible immediately to end users.

---

*Generated as a read-only audit. No source files were modified. When you're ready to apply changes, the easiest entry point is finding #1 — once contextIsolation is on, several of the other findings (especially #4 and #10) become genuinely necessary rather than defense-in-depth.*
