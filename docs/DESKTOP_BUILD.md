# Building the desktop app

## Prerequisite: a C/C++ linker (one-time)

Rust on Windows targets MSVC by default and needs a linker, which does not
come with Rust itself. Without it the build fails at the final step:

```
error: linker `link.exe` not found
```

Install **Visual Studio Build Tools** (free), selecting the
*Desktop development with C++* workload:

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Or download it manually: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>

Then open a **new** terminal so the toolchain is on PATH.

## Build

```bash
cd desktop
cargo build --release
```

The executable lands in `desktop/target/release/`. For an installer:

```bash
cargo install tauri-cli --version "^2"
cargo tauri build
```

## A note on Git Bash

Build from PowerShell or cmd, not Git Bash. MSYS ships a GNU `link` utility
that shadows MSVC's `link.exe`, producing a confusing failure where the
linker reports `Try 'link --help'` — that is coreutils answering, not MSVC.

## Previewing the UI without building

The entire frontend (card, settings, quiz engine, question banks) runs in a
plain browser, so UI work does not need the Rust toolchain at all:

```bash
node test-harness/serve.js
```

Then open `http://localhost:8792/desktop/ui/_preview.html`. `_preview-shim.js`
stubs `window.__TAURI__` — `invoke()` records calls into
`window.__TAURI_PREVIEW_CALLS__` so you can assert the frontend asked Rust to
show/resize the window, and the event bus is real pub/sub so `start-quiz`
genuinely drives the flow. Only the Rust shell (window flags, tray, hotkey)
needs a real build to verify.
