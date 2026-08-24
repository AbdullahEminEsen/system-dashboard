{
  "targets": [
    {
      "target_name": "sysmetrics",
      "sources": [ "metrics.cc" ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "libraries": [ "psapi.lib" ],
      "defines": [ "NAPI_VERSION=8" ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      }
    }
  ]
}
