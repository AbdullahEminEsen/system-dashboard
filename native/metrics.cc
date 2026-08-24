// sysmetrics — native Windows metrics for System Dashboard.
//
// Exposes:
//   hello()          -> "native ok"
//   processCount()   -> number                 (EnumProcesses; native tasklist)
//   gpuList()        -> [{index,name}] | null   (NVML enumeration)
//   gpu(index)       -> {name?,load,memLoad?,temp?,power?,memUsed?,memTotal?} | null
//
// GPU stats come from NVIDIA NVML when available (full: load/temp/power/VRAM).
// On non-NVIDIA GPUs (AMD/Intel) NVML is absent, so we fall back to Windows PDH
// performance counters — the same source Task Manager uses — for vendor-agnostic
// GPU utilization and dedicated VRAM usage. (Temperature/power on AMD would need
// AMD's ADL library; not covered here.)

#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <pdh.h>
#include <pdhmsg.h>
#include <vector>
#include <map>
#include <string>
#include <cstdlib>
#include <cstring>

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

static HMODULE g_nvml = NULL;
static bool g_ready = false, g_tried = false;
static PFN_init p_init = NULL; static PFN_count p_count = NULL; static PFN_handle p_handle = NULL;
static PFN_name p_name = NULL; static PFN_util p_util = NULL; static PFN_temp p_temp = NULL;
static PFN_power p_power = NULL; static PFN_mem p_mem = NULL;

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
  exports.Set("gpuList", Napi::Function::New(env, GpuList));
  exports.Set("gpu", Napi::Function::New(env, Gpu));
  exports.Set("gpuAmdDump", Napi::Function::New(env, GpuAmdDump));
  return exports;
}

NODE_API_MODULE(sysmetrics, Init)