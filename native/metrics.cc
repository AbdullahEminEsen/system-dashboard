// sysmetrics — native Windows metrics for System Dashboard.
//
// Exposes:
//   hello()          -> "native ok"           (sanity check)
//   processCount()   -> number                (EnumProcesses; the native tasklist)
//   gpuList()        -> [{index,name}] | null  (NVML enumeration)
//   gpu(index)       -> {name,load,memLoad,temp,power,memUsed,memTotal} | null
//
// NVML (NVIDIA Management Library) is loaded dynamically from nvml.dll at
// runtime, so no CUDA/NVML SDK headers are needed to build, and machines with
// no NVIDIA driver simply get null (the app falls back to systeminformation).

#include <napi.h>
#include <windows.h>
#include <psapi.h>

// ── NVML types (declared here so we don't need the NVML SDK headers) ─────────
typedef int nvmlReturn_t;                 // NVML_SUCCESS == 0
typedef void* nvmlDevice_t;
struct nvmlUtilization_t { unsigned int gpu; unsigned int memory; };
struct nvmlMemory_t { unsigned long long total; unsigned long long free; unsigned long long used; };

typedef nvmlReturn_t (*PFN_init)();
typedef nvmlReturn_t (*PFN_shutdown)();
typedef nvmlReturn_t (*PFN_count)(unsigned int*);
typedef nvmlReturn_t (*PFN_handle)(unsigned int, nvmlDevice_t*);
typedef nvmlReturn_t (*PFN_name)(nvmlDevice_t, char*, unsigned int);
typedef nvmlReturn_t (*PFN_util)(nvmlDevice_t, nvmlUtilization_t*);
typedef nvmlReturn_t (*PFN_temp)(nvmlDevice_t, int, unsigned int*);
typedef nvmlReturn_t (*PFN_power)(nvmlDevice_t, unsigned int*);
typedef nvmlReturn_t (*PFN_mem)(nvmlDevice_t, nvmlMemory_t*);

static HMODULE g_nvml = NULL;
static bool g_ready = false;
static bool g_tried = false;
static PFN_init    p_init = NULL;
static PFN_count   p_count = NULL;
static PFN_handle  p_handle = NULL;
static PFN_name    p_name = NULL;
static PFN_util    p_util = NULL;
static PFN_temp    p_temp = NULL;
static PFN_power   p_power = NULL;
static PFN_mem     p_mem = NULL;

template <typename T>
static T loadFn(HMODULE h, const char* primary, const char* fallback = NULL) {
  FARPROC p = GetProcAddress(h, primary);
  if (!p && fallback) p = GetProcAddress(h, fallback);
  return reinterpret_cast<T>(p);
}

// Load nvml.dll and initialize NVML once. Returns false on any machine without
// a working NVIDIA driver so callers can fall back gracefully.
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

// ── Exports ─────────────────────────────────────────────────────────────────
Napi::Value Hello(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "native ok");
}

Napi::Value ProcessCount(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  DWORD pids[8192];
  DWORD bytesReturned = 0;
  if (!EnumProcesses(pids, sizeof(pids), &bytesReturned)) {
    return Napi::Number::New(env, -1);
  }
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
      char buf[128] = {0};
      if (p_name(dev, buf, sizeof(buf)) == 0) o.Set("name", Napi::String::New(env, buf));
    }
    arr.Set(i, o);
  }
  return arr;
}

Napi::Value Gpu(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  unsigned int index = 0;
  if (info.Length() > 0 && info[0].IsNumber()) index = info[0].As<Napi::Number>().Uint32Value();
  if (!ensureNvml()) return env.Null();

  nvmlDevice_t dev = NULL;
  if (p_handle(index, &dev) != 0 || !dev) {
    if (p_handle(0, &dev) != 0 || !dev) return env.Null();
  }

  Napi::Object o = Napi::Object::New(env);
  if (p_name) {
    char buf[128] = {0};
    if (p_name(dev, buf, sizeof(buf)) == 0) o.Set("name", Napi::String::New(env, buf));
  }
  if (p_util) {
    nvmlUtilization_t u = {0, 0};
    if (p_util(dev, &u) == 0) {
      o.Set("load", Napi::Number::New(env, u.gpu));
      o.Set("memLoad", Napi::Number::New(env, u.memory));
    }
  }
  if (p_temp) {
    unsigned int t = 0;
    if (p_temp(dev, 0 /* NVML_TEMPERATURE_GPU */, &t) == 0) o.Set("temp", Napi::Number::New(env, t));
  }
  if (p_power) {
    unsigned int mw = 0;
    if (p_power(dev, &mw) == 0) o.Set("power", Napi::Number::New(env, mw / 1000.0));
  }
  if (p_mem) {
    nvmlMemory_t m = {0, 0, 0};
    if (p_mem(dev, &m) == 0) {
      o.Set("memUsed", Napi::Number::New(env, (double)(m.used / 1048576ULL)));
      o.Set("memTotal", Napi::Number::New(env, (double)(m.total / 1048576ULL)));
    }
  }
  return o;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("hello", Napi::Function::New(env, Hello));
  exports.Set("processCount", Napi::Function::New(env, ProcessCount));
  exports.Set("gpuList", Napi::Function::New(env, GpuList));
  exports.Set("gpu", Napi::Function::New(env, Gpu));
  return exports;
}

NODE_API_MODULE(sysmetrics, Init)
