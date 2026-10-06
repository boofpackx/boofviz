{
  "targets": [
    {
      "target_name": "boofviz_link",
      "sources": ["src/link_addon.cc"],
      "include_dirs": [
        "vendor/link/include",
        "vendor/link/modules/asio-standalone/asio/include"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except"],
      "defines": ["ASIO_STANDALONE=1", "NAPI_VERSION=8"],
      "conditions": [
        ["OS=='win'", {
          "defines": ["LINK_PLATFORM_WINDOWS=1", "_WIN32_WINNT=0x0601", "NOMINMAX", "WIN32_LEAN_AND_MEAN"],
          "libraries": ["ws2_32.lib", "iphlpapi.lib", "winmm.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17", "/bigobj"] }
          }
        }],
        ["OS=='mac'", {
          "defines": ["LINK_PLATFORM_MACOSX=1"],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }],
        ["OS=='linux'", {
          "defines": ["LINK_PLATFORM_LINUX=1"],
          "cflags_cc": ["-std=c++17", "-fexceptions", "-pthread"],
          "cflags_cc!": ["-fno-exceptions", "-std=gnu++17"],
          "ldflags": ["-pthread"]
        }]
      ]
    }
  ]
}
