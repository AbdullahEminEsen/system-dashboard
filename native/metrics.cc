// sysmetrics — native Windows metrics for System Dashboard.
//
// Exposes:
//   hello()          -> "native ok"
//   processCount()   -> number                 (EnumProcesses; native tasklist)
//   netBytes()       -> {rx,tx} | null          (GetIfTable2 octet counters, physical NICs)
//   gpuList()        -> [{index,name}] | null   (NVML enumeration)
//   adapters()       -> [{name,luid,vram}] | null (DXGI; luid matches PDH instance names)
//   gpuProcesses()   -> [{pid,name,luid,mem,load}] | null (PDH per-process GPU, like Task Manager)
//   gpu(index)       -> {name?,load,memLoad?,temp?,power?,memUsed?,memTotal?,
//                        clockCore?,clockMem?,fan?,throttle?} | null
//
// GPU stats come from NVIDIA NVML when available (full: load/temp/power/VRAM).
// On non-NVIDIA GPUs (AMD/Intel) NVML is absent, so we fall back to Windows PDH
// performance counters — the same source Task Manager uses — for vendor-agnostic
// GPU utilization and dedicated VRAM usage. (Temperature/power on AMD would need
// AMD's ADL library; not covered here.)

// GetIfTable2 & co. are Vista+ APIs; make sure the SDK headers expose them.
#if !defined(_WIN32_WINNT) || _WIN32_WINNT < 0x0600
#undef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <napi.h>
#include <winsock2.h>
#include <ws2ipdef.h>   // netioapi.h only declares GetIfTable2 when this is in scope
#include <windows.h>
#include <iphlpapi.h>
#include <netioapi.h>
#include <dxgi.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <pdh.h>
#include <pdhmsg.h>
#include <vector>
#include <map>
#include <string>
#include <cstdlib>
#include <cstring>
#include <cstdio>

// ── NVML (dynamically loaded; no SDK headers needed) ────────────────────────
typedef int nvmlReturn_t;                 // NVML_SUCCESS == 0
typedef void* nvmlDevice_t;
struct nvmlUtilization_t { unsigned int gpu; unsigned int memory; };
struct nvmlMemory_t { unsigned long long total; unsigned long long free; unsigned long long used; };

typedef nvmlReturn_t (*PFN_init)();
typedef nvmlReturn_t (*PFN_count)(unsigned int*);
typedef nvmlReturn_t (*PFN_handle)(unsigned int, nvmlDevice_t*);
typedef nvmlReturn_t (*PFN_name)(nvmlDevice_t, char*, unsigned int);
typedef nvmlReturn_t (*PFN_util)(nvmlDevice_t, nvmlUtilization_t*);
typedef nvmlReturn_t (*PFN_temp)(nvmlDevice_t, int, unsigned int*);
typedef nvmlReturn_t (*PFN_power)(nvmlDevice_t, unsigned int*);
typedef nvmlReturn_t (*PFN_mem)(nvmlDevice_t, nvmlMemory_t*);
typedef nvmlReturn_t (*PFN_clock)(nvmlDevice_t, int, unsigned int*);
typedef nvmlReturn_t (*PFN_fan)(nvmlDevice_t, unsigned int*);
typedef nvmlReturn_t (*PFN_reasons)(nvmlDevice_t, unsigned long long*);

// nvmlClockType_t
#define NVML_CLOCK_GRAPHICS 0
#define NVML_CLOCK_MEM      2

static HMODULE g_nvml = NULL;
static bool g_ready = false, g_tried = false;
static PFN_init p_init = NULL; static PFN_count p_count = NULL; static PFN_handle p_handle = NULL;
static PFN_name p_name = NULL; static PFN_util p_util = NULL; static PFN_temp p_temp = NULL;
static PFN_power p_power = NULL; static PFN_mem p_mem = NULL;
static PFN_clock p_clock = NULL; static PFN_fan p_fan = NULL; static PFN_reasons p_reasons = NULL;

template <typename T>
static T loadFn(HMODULE h, const char* primary, const char* fallback = NULL) {
  FARPROC p = GetProcAddress(h, primary);
  if (!p && fallback) p = GetProcAddress(h, fallback);
  return reinterpret_cast<T>(p);
}

static bool ensureNvml() {
  if (g_ready) return true;
  if (g_tried) return false;
  g_tried = true;
  g_nvml = LoadLibraryA("nvml.dll");
  if (!g_nvml) g_nvml = LoadLibraryA("C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvml.dll");
  if (!g_nvml) return false;
  p_init   = loadFn<PFN_init>(g_nvml, "nvmlInit_v2", "nvmlInit");
  p_count  = loadFn<PFN_count>(g_nvml, "nvmlDeviceGetCount_v2", "nvmlDeviceGetCount");
  p_handle = loadFn<PFN_handle>(g_nvml, "nvmlDeviceGetHandleByIndex_v2", "nvmlDeviceGetHandleByIndex");
  p_name   = loadFn<PFN_name>(g_nvml, "nvmlDeviceGetName");
  p_util   = loadFn<PFN_util>(g_nvml, "nvmlDeviceGetUtilizationRates");
  p_temp   = loadFn<PFN_temp>(g_nvml, "nvmlDeviceGetTemperature");
  p_power  = loadFn<PFN_power>(g_nvml, "nvmlDeviceGetPowerUsage");
  p_mem    = loadFn<PFN_mem>(g_nvml, "nvmlDeviceGetMemoryInfo");
  p_clock  = loadFn<PFN_clock>(g_nvml, "nvmlDeviceGetClockInfo");
  p_fan    = loadFn<PFN_fan>(g_nvml, "nvmlDeviceGetFanSpeed");
  // Renamed to "ClocksEventReasons" in newer drivers; the old name is kept as an alias.
  p_reasons = loadFn<PFN_reasons>(g_nvml, "nvmlDeviceGetCurrentClocksEventReasons", "nvmlDeviceGetCurrentClocksThrottleReasons");
  if (!p_init || !p_handle) return false;
  if (p_init() != 0) return false;
  g_ready = true;
  return true;
}

// ── PDH (vendor-agnostic GPU counters, like Task Manager) ────────────────────
static PDH_HQUERY   g_query = NULL;
static PDH_HCOUNTER g_cUtil = NULL;   // \GPU Engine(*)\Utilization Percentage
static PDH_HCOUNTER g_cVram = NULL;   // \GPU Adapter Memory(*)\Dedicated Usage
static bool g_pdhReady = false, g_pdhTried = false;

static bool ensurePdh() {
  if (g_pdhReady) return true;
  if (g_pdhTried) return false;
  g_pdhTried = true;
  if (PdhOpenQueryW(NULL, 0, &g_query) != ERROR_SUCCESS) return false;
  if (PdhAddEnglishCounterW(g_query, L"\\GPU Engine(*)\\Utilization Percentage", 0, &g_cUtil) != ERROR_SUCCESS) {
    PdhCloseQuery(g_query); g_query = NULL; return false;
  }
  // VRAM counter is optional — ignore failure.
  PdhAddEnglishCounterW(g_query, L"\\GPU Adapter Memory(*)\\Dedicated Usage", 0, &g_cVram);
  PdhCollectQueryData(g_query); // prime (rate counters need a first sample)
  g_pdhReady = true;
  return true;
}

// Overall GPU utilization %: group engine instances by type, sum within a type,
// take the busiest type (this tracks Task Manager's headline number closely).
static double pdhUtil() {
  if (PdhCollectQueryData(g_query) != ERROR_SUCCESS) return -1;
  DWORD size = 0, count = 0;
  if (PdhGetFormattedCounterArrayW(g_cUtil, PDH_FMT_DOUBLE, &size, &count, NULL) != PDH_MORE_DATA || size == 0) return -1;
  std::vector<BYTE> buf(size);
  PDH_FMT_COUNTERVALUE_ITEM_W* items = reinterpret_cast<PDH_FMT_COUNTERVALUE_ITEM_W*>(buf.data());
  if (PdhGetFormattedCounterArrayW(g_cUtil, PDH_FMT_DOUBLE, &size, &count, items) != ERROR_SUCCESS) return -1;
  std::map<std::wstring, double> byType;
  for (DWORD i = 0; i < count; i++) {
    LONG cs = items[i].FmtValue.CStatus;
    if (cs != PDH_CSTATUS_VALID_DATA && cs != PDH_CSTATUS_NEW_DATA) continue;
    double v = items[i].FmtValue.doubleValue;
    if (v <= 0) continue;
    std::wstring nm = items[i].szName ? items[i].szName : L"";
    size_t pos = nm.find(L"engtype_");
    std::wstring key = (pos != std::wstring::npos) ? nm.substr(pos + 8) : nm;
    byType[key] += v;
  }
  double best = 0;
  for (std::map<std::wstring, double>::iterator it = byType.begin(); it != byType.end(); ++it)
    if (it->second > best) best = it->second;
  if (best > 100) best = 100;
  return best;
}

// Dedicated VRAM in use, in MB (summed across adapters).
static double pdhVramMB() {
  if (!g_cVram) return -1;
  DWORD size = 0, count = 0;
  if (PdhGetFormattedCounterArrayW(g_cVram, PDH_FMT_LARGE, &size, &count, NULL) != PDH_MORE_DATA || size == 0) return -1;
  std::vector<BYTE> buf(size);
  PDH_FMT_COUNTERVALUE_ITEM_W* items = reinterpret_cast<PDH_FMT_COUNTERVALUE_ITEM_W*>(buf.data());
  if (PdhGetFormattedCounterArrayW(g_cVram, PDH_FMT_LARGE, &size, &count, items) != ERROR_SUCCESS) return -1;
  long long total = 0;
  for (DWORD i = 0; i < count; i++) {
    LONG cs = items[i].FmtValue.CStatus;
    if (cs != PDH_CSTATUS_VALID_DATA && cs != PDH_CSTATUS_NEW_DATA) continue;
    total += items[i].FmtValue.largeValue;
  }
  return (double)(total / 1048576LL);
}

// ── Per-process GPU (PDH) ───────────────────────────────────────────────────
// Separate query from g_query: both hold rate counters, and collecting one query
// twice in the same tick would make the second utilization delta meaningless.
// NVML's per-process memory is not used because under WDDM (all GeForce cards
// on Windows) it reports NVML_VALUE_NOT_AVAILABLE.
static PDH_HQUERY   g_pq = NULL;
static PDH_HCOUNTER g_pUtil = NULL;   // \GPU Engine(pid_*)\Utilization Percentage
static PDH_HCOUNTER g_pMem = NULL;    // \GPU Process Memory(pid_*)\Dedicated Usage
static bool g_pqReady = false, g_pqTried = false;

static bool ensureProcPdh() {
  if (g_pqReady) return true;
  if (g_pqTried) return false;
  g_pqTried = true;
  if (PdhOpenQueryW(NULL, 0, &g_pq) != ERROR_SUCCESS) return false;
  PdhAddEnglishCounterW(g_pq, L"\\GPU Engine(*)\\Utilization Percentage", 0, &g_pUtil);
  PdhAddEnglishCounterW(g_pq, L"\\GPU Process Memory(*)\\Dedicated Usage", 0, &g_pMem);
  if (!g_pUtil && !g_pMem) { PdhCloseQuery(g_pq); g_pq = NULL; return false; }
  PdhCollectQueryData(g_pq); // prime the rate counter
  g_pqReady = true;
  return true;
}

// "pid_1234_luid_0x00000000_0x0000D1B2_phys_0[_eng_0_engtype_3D]"
//   -> pid 1234, luid "0x00000000_0x0000D1B2", engtype "3D" (may be empty)
static bool parseGpuInstance(const std::wstring& nm, DWORD* pid, std::wstring* luid, std::wstring* eng) {
  if (nm.compare(0, 4, L"pid_") != 0) return false;
  *pid = (DWORD)wcstoul(nm.c_str() + 4, NULL, 10);
  size_t l = nm.find(L"luid_");
  if (l == std::wstring::npos) return false;
  size_t p = nm.find(L"_phys", l);
  *luid = nm.substr(l + 5, (p == std::wstring::npos ? nm.size() : p) - (l + 5));
  size_t e = nm.find(L"engtype_");
  *eng = (e == std::wstring::npos) ? L"" : nm.substr(e + 8);
  return true;
}

static bool getCounterArray(PDH_HCOUNTER c, DWORD fmt, std::vector<BYTE>& buf, DWORD* count) {
  DWORD size = 0; *count = 0;
  if (!c) return false;
  if (PdhGetFormattedCounterArrayW(c, fmt, &size, count, NULL) != PDH_MORE_DATA || size == 0) return false;
  buf.resize(size);
  return PdhGetFormattedCounterArrayW(c, fmt, &size, count,
    reinterpret_cast<PDH_FMT_COUNTERVALUE_ITEM_W*>(buf.data())) == ERROR_SUCCESS;
}

static std::string toUtf8(const std::wstring& w) {
  if (w.empty()) return std::string();
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), NULL, 0, NULL, NULL);
  std::string s(n, 0);
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, NULL, NULL);
  return s;
}

// pid -> executable name for every running process. A Toolhelp snapshot needs no
// access rights, unlike OpenProcess, so protected processes (dwm.exe, csrss.exe)
// still get a name.
static std::map<DWORD, std::string> processNames() {
  std::map<DWORD, std::string> out;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return out;
  PROCESSENTRY32W pe; pe.dwSize = sizeof(pe);
  if (Process32FirstW(snap, &pe)) {
    do { out[pe.th32ProcessID] = toUtf8(pe.szExeFile); } while (Process32NextW(snap, &pe));
  }
  CloseHandle(snap);
  return out;
}

// ── AMD ADL (temperature / power via PMLog; dynamically loaded) ──────────────
#define ADL_PMLOG_MAX_SENSORS 256
struct ADLSingleSensorData { int supported; int value; };
struct ADLPMLogDataOutput { int size; ADLSingleSensorData sensors[ADL_PMLOG_MAX_SENSORS]; };
typedef void* ADL_CONTEXT_HANDLE;
typedef void* (*ADL_MALLOC)(int);
static void* ADL_Alloc(int s) { return malloc(s); }
typedef int (*PFN_ADL2_Create)(ADL_MALLOC, int, ADL_CONTEXT_HANDLE*);
typedef int (*PFN_ADL2_NumAdapters)(ADL_CONTEXT_HANDLE, int*);
typedef int (*PFN_ADL2_PMLog)(ADL_CONTEXT_HANDLE, int, ADLPMLogDataOutput*);

// PMLog sensor indices (confirmed against an RX 6600 XT via gpuAmdDump:
// 8=edge °C, 27=hotspot °C, 23=ASIC power W, 20=memory activity %).
#define PM_TEMP_EDGE     8
#define PM_TEMP_HOTSPOT  27
#define PM_ASIC_POWER    23
#define PM_ACTIVITY_MEM  20

static HMODULE g_adl = NULL;
static ADL_CONTEXT_HANDLE g_adlCtx = NULL;
static bool g_adlReady = false, g_adlTried = false;
static int  g_adlAdapter = -1;
static PFN_ADL2_PMLog padl_pmlog = NULL;

static bool ensureAdl() {
  if (g_adlReady) return true;
  if (g_adlTried) return false;
  g_adlTried = true;
  g_adl = LoadLibraryA("atiadlxx.dll");
  if (!g_adl) return false;
  PFN_ADL2_Create create = (PFN_ADL2_Create)GetProcAddress(g_adl, "ADL2_Main_Control_Create");
  PFN_ADL2_NumAdapters num = (PFN_ADL2_NumAdapters)GetProcAddress(g_adl, "ADL2_Adapter_NumberOfAdapters_Get");
  padl_pmlog = (PFN_ADL2_PMLog)GetProcAddress(g_adl, "ADL2_New_QueryPMLogData_Get");
  if (!create || !padl_pmlog) return false;
  if (create(ADL_Alloc, 1, &g_adlCtx) != 0 || !g_adlCtx) return false;
  int n = 0;
  if (num && num(g_adlCtx, &n) == 0) {
    for (int i = 0; i < n; i++) {
      ADLPMLogDataOutput out; memset(&out, 0, sizeof(out));
      if (padl_pmlog(g_adlCtx, i, &out) == 0) {
        // accept the first adapter that reports any supported sensor
        for (int s = 0; s < ADL_PMLOG_MAX_SENSORS; s++) {
          if (out.sensors[s].supported) { g_adlAdapter = i; break; }
        }
        if (g_adlAdapter >= 0) break;
      }
    }
  }
  if (g_adlAdapter < 0) return false;
  g_adlReady = true;
  return true;
}

// ── Exports ─────────────────────────────────────────────────────────────────
Napi::Value Hello(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "native ok");
}

Napi::Value ProcessCount(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  DWORD pids[8192];
  DWORD bytesReturned = 0;
  if (!EnumProcesses(pids, sizeof(pids), &bytesReturned)) return Napi::Number::New(env, -1);
  return Napi::Number::New(env, (int)(bytesReturned / sizeof(DWORD)));
}

// Total bytes received/sent on physical, connected adapters. JS turns two
// samples into a rate. This replaces systeminformation's networkStats(), which
// on Windows spawns PowerShell and took ~18s on its first call.
Napi::Value NetBytes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  PMIB_IF_TABLE2 table = NULL;
  if (GetIfTable2(&table) != NO_ERROR || !table) return env.Null();
  unsigned long long rx = 0, tx = 0;
  for (ULONG i = 0; i < table->NumEntries; i++) {
    const MIB_IF_ROW2& r = table->Table[i];
    if (r.Type == IF_TYPE_SOFTWARE_LOOPBACK) continue;
    if (r.OperStatus != IfOperStatusUp) continue;
    // Skip virtual/filter rows (Hyper-V, VPN shims, WFP/QoS filter layers) that
    // mirror the same traffic and would double-count it.
    if (!r.InterfaceAndOperStatusFlags.HardwareInterface) continue;
    if (r.InterfaceAndOperStatusFlags.FilterInterface) continue;
    rx += r.InOctets;
    tx += r.OutOctets;
  }
  FreeMibTable(table);
  Napi::Object o = Napi::Object::New(env);
  o.Set("rx", Napi::Number::New(env, (double)rx));
  o.Set("tx", Napi::Number::New(env, (double)tx));
  return o;
}

// DXGI adapters with their LUID formatted the way PDH instance names spell it,
// so per-process rows can be attributed to the right GPU on hybrid laptops.
Napi::Value Adapters(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  IDXGIFactory1* factory = NULL;
  if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&factory)) || !factory) return env.Null();
  Napi::Array arr = Napi::Array::New(env);
  unsigned int k = 0;
  IDXGIAdapter1* ad = NULL;
  for (UINT i = 0; factory->EnumAdapters1(i, &ad) != DXGI_ERROR_NOT_FOUND; i++) {
    DXGI_ADAPTER_DESC1 d;
    if (SUCCEEDED(ad->GetDesc1(&d)) && !(d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE)) {
      char luid[32];
      snprintf(luid, sizeof(luid), "0x%08X_0x%08X", (unsigned)d.AdapterLuid.HighPart, (unsigned)d.AdapterLuid.LowPart);
      Napi::Object o = Napi::Object::New(env);
      o.Set("name", Napi::String::New(env, toUtf8(d.Description)));
      o.Set("luid", Napi::String::New(env, luid));
      o.Set("vram", Napi::Number::New(env, (double)(d.DedicatedVideoMemory / 1048576ULL)));
      arr.Set(k++, o);
    }
    ad->Release();
  }
  factory->Release();
  return arr;
}

// Per-process GPU usage across all adapters: dedicated VRAM (MB) and load (%,
// busiest engine type, same rule as pdhUtil). The caller filters by luid.
Napi::Value GpuProcesses(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!ensureProcPdh()) return env.Null();
  if (PdhCollectQueryData(g_pq) != ERROR_SUCCESS) return env.Null();

  struct Row { DWORD pid = 0; std::wstring luid; double mem = 0; std::map<std::wstring, double> eng; };
  std::map<std::wstring, Row> rows; // key: pid|luid
  std::vector<BYTE> buf; DWORD count = 0;
  DWORD pid; std::wstring luid, eng;

  if (getCounterArray(g_pMem, PDH_FMT_LARGE, buf, &count)) {
    PDH_FMT_COUNTERVALUE_ITEM_W* it = reinterpret_cast<PDH_FMT_COUNTERVALUE_ITEM_W*>(buf.data());
    for (DWORD i = 0; i < count; i++) {
      LONG cs = it[i].FmtValue.CStatus;
      if (cs != PDH_CSTATUS_VALID_DATA && cs != PDH_CSTATUS_NEW_DATA) continue;
      if (!it[i].szName || !parseGpuInstance(it[i].szName, &pid, &luid, &eng)) continue;
      Row& r = rows[std::to_wstring(pid) + L"|" + luid];
      r.pid = pid; r.luid = luid;
      r.mem += (double)it[i].FmtValue.largeValue / 1048576.0;
    }
  }
  if (getCounterArray(g_pUtil, PDH_FMT_DOUBLE, buf, &count)) {
    PDH_FMT_COUNTERVALUE_ITEM_W* it = reinterpret_cast<PDH_FMT_COUNTERVALUE_ITEM_W*>(buf.data());
    for (DWORD i = 0; i < count; i++) {
      LONG cs = it[i].FmtValue.CStatus;
      if (cs != PDH_CSTATUS_VALID_DATA && cs != PDH_CSTATUS_NEW_DATA) continue;
      double v = it[i].FmtValue.doubleValue;
      if (v <= 0) continue;
      if (!it[i].szName || !parseGpuInstance(it[i].szName, &pid, &luid, &eng)) continue;
      Row& r = rows[std::to_wstring(pid) + L"|" + luid];
      r.pid = pid; r.luid = luid;
      r.eng[eng] += v;
    }
  }

  std::map<DWORD, std::string> names = processNames();
  Napi::Array arr = Napi::Array::New(env);
  unsigned int k = 0;
  for (std::map<std::wstring, Row>::iterator it = rows.begin(); it != rows.end(); ++it) {
    const Row& r = it->second;
    double load = 0;
    for (std::map<std::wstring, double>::const_iterator e = r.eng.begin(); e != r.eng.end(); ++e)
      if (e->second > load) load = e->second;
    if (load > 100) load = 100;
    if (r.mem < 1 && load < 0.5) continue; // idle and holding no VRAM
    Napi::Object o = Napi::Object::New(env);
    o.Set("pid", Napi::Number::New(env, r.pid));
    std::map<DWORD, std::string>::const_iterator nm = names.find(r.pid);
    o.Set("name", Napi::String::New(env, nm != names.end() ? nm->second : std::string()));
    o.Set("luid", Napi::String::New(env, toUtf8(r.luid)));
    o.Set("mem", Napi::Number::New(env, r.mem));
    o.Set("load", Napi::Number::New(env, load));
    arr.Set(k++, o);
  }
  return arr;
}

Napi::Value GpuList(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!ensureNvml() || !p_count) return env.Null();
  unsigned int n = 0;
  if (p_count(&n) != 0) return env.Null();
  Napi::Array arr = Napi::Array::New(env, n);
  for (unsigned int i = 0; i < n; i++) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("index", Napi::Number::New(env, i));
    nvmlDevice_t dev = NULL;
    if (p_handle(i, &dev) == 0 && dev && p_name) {
      char b[128] = {0};
      if (p_name(dev, b, sizeof(b)) == 0) o.Set("name", Napi::String::New(env, b));
    }
    arr.Set(i, o);
  }
  return arr;
}

Napi::Value Gpu(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  unsigned int index = 0;
  if (info.Length() > 0 && info[0].IsNumber()) index = info[0].As<Napi::Number>().Uint32Value();

  // 1) NVIDIA NVML — full metrics.
  if (ensureNvml()) {
    nvmlDevice_t dev = NULL;
    if ((p_handle(index, &dev) != 0 || !dev) && (p_handle(0, &dev) != 0)) dev = NULL;
    if (dev) {
      Napi::Object o = Napi::Object::New(env);
      if (p_name) { char b[128] = {0}; if (p_name(dev, b, sizeof(b)) == 0) o.Set("name", Napi::String::New(env, b)); }
      if (p_util) { nvmlUtilization_t u = {0,0}; if (p_util(dev,&u)==0) { o.Set("load", Napi::Number::New(env,u.gpu)); o.Set("memLoad", Napi::Number::New(env,u.memory)); } }
      if (p_temp) { unsigned int t=0; if (p_temp(dev,0,&t)==0) o.Set("temp", Napi::Number::New(env,t)); }
      if (p_power){ unsigned int mw=0; if (p_power(dev,&mw)==0) o.Set("power", Napi::Number::New(env, mw/1000.0)); }
      if (p_mem)  { nvmlMemory_t m={0,0,0}; if (p_mem(dev,&m)==0){ o.Set("memUsed", Napi::Number::New(env,(double)(m.used/1048576ULL))); o.Set("memTotal", Napi::Number::New(env,(double)(m.total/1048576ULL))); } }
      if (p_clock){ unsigned int c=0; if (p_clock(dev,NVML_CLOCK_GRAPHICS,&c)==0) o.Set("clockCore", Napi::Number::New(env,c));
                    c=0; if (p_clock(dev,NVML_CLOCK_MEM,&c)==0) o.Set("clockMem", Napi::Number::New(env,c)); }
      // Laptop GPUs usually have no driver-controlled fan -> NOT_SUPPORTED, key left unset.
      if (p_fan)  { unsigned int f=0; if (p_fan(dev,&f)==0) o.Set("fan", Napi::Number::New(env,f)); }
      // Raw clocks-event bitmask; decoded in JS (power cap / thermal / idle ...).
      if (p_reasons){ unsigned long long r=0; if (p_reasons(dev,&r)==0) o.Set("throttle", Napi::Number::New(env,(double)r)); }
      return o;
    }
  }

  // 2) PDH fallback — vendor-agnostic utilization + VRAM (AMD/Intel/NVIDIA).
  if (!ensurePdh()) return env.Null();
  double util = pdhUtil();
  if (util < 0) return env.Null();
  Napi::Object o = Napi::Object::New(env);
  o.Set("load", Napi::Number::New(env, util));
  double vram = pdhVramMB();
  if (vram >= 0) o.Set("memUsed", Napi::Number::New(env, vram));

  // 3) AMD temperature/power via ADL PMLog (NVIDIA already handled above).
  if (ensureAdl()) {
    ADLPMLogDataOutput out; memset(&out, 0, sizeof(out));
    if (padl_pmlog(g_adlCtx, g_adlAdapter, &out) == 0) {
      if (out.sensors[PM_TEMP_EDGE].supported) o.Set("temp", Napi::Number::New(env, out.sensors[PM_TEMP_EDGE].value));
      else if (out.sensors[PM_TEMP_HOTSPOT].supported) o.Set("temp", Napi::Number::New(env, out.sensors[PM_TEMP_HOTSPOT].value));
      if (out.sensors[PM_ASIC_POWER].supported) o.Set("power", Napi::Number::New(env, out.sensors[PM_ASIC_POWER].value));
      if (out.sensors[PM_ACTIVITY_MEM].supported) o.Set("memLoad", Napi::Number::New(env, out.sensors[PM_ACTIVITY_MEM].value));
    }
  }
  return o; // memTotal/name left undefined -> filled by caller
}

// Diagnostic: dump every supported ADL PMLog sensor (index + value) so we can
// confirm which index holds temperature/power on a specific AMD card.
Napi::Value GpuAmdDump(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!ensureAdl()) return env.Null();
  ADLPMLogDataOutput out; memset(&out, 0, sizeof(out));
  if (padl_pmlog(g_adlCtx, g_adlAdapter, &out) != 0) return env.Null();
  Napi::Array arr = Napi::Array::New(env);
  unsigned int k = 0;
  for (int i = 0; i < ADL_PMLOG_MAX_SENSORS; i++) {
    if (out.sensors[i].supported) {
      Napi::Object o = Napi::Object::New(env);
      o.Set("index", Napi::Number::New(env, i));
      o.Set("value", Napi::Number::New(env, out.sensors[i].value));
      arr.Set(k++, o);
    }
  }
  return arr;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("hello", Napi::Function::New(env, Hello));
  exports.Set("processCount", Napi::Function::New(env, ProcessCount));
  exports.Set("netBytes", Napi::Function::New(env, NetBytes));
  exports.Set("adapters", Napi::Function::New(env, Adapters));
  exports.Set("gpuProcesses", Napi::Function::New(env, GpuProcesses));
  exports.Set("gpuList", Napi::Function::New(env, GpuList));
  exports.Set("gpu", Napi::Function::New(env, Gpu));
  exports.Set("gpuAmdDump", Napi::Function::New(env, GpuAmdDump));
  return exports;
}

NODE_API_MODULE(sysmetrics, Init)