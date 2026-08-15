# Building the desktop app

There are two shells over the same `ui/` folder. Pick by what you value:

| | Electron (`npm run build`) | Tauri (`cargo build`) |
|---|---|---|
| Installer | ~81 MB | ~6 MB |
| Idle RAM | ~90 MB (4 processes) | ~30 MB (uses the system WebView2) |
| Toolchain | Node + npm only | Rust **and an MSVC linker** |

Electron is the fallback that builds anywhere Node does. Tauri is the one to
ship if you can build it — same UI, a fraction of the size and memory.

## Electron

```bash
cd desktop
npm install
npm run build     # -> desktop/dist/*.exe (installer + portable)
```

## Tauri

### Prerequisite: a C/C++ linker (one-time)

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

### Build

```bash
cd desktop/tauri
cargo build --release
```

The executable lands in `desktop/tauri/target/release/`. For an installer:

```bash
cargo install tauri-cli --version "^2"
cargo tauri build
```

If cargo still cannot find `link.exe` after installing the Build Tools, the
linker is on disk but not on PATH. Run the build from a shell that has the
MSVC environment loaded:

```bash
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio8\BuildTools\VC\Auxiliary\Buildcvars64.bat" && cargo build --release'
```

(Adjust the year/edition in that path to match your install. `vswhere` may
report the VC component as missing even when it is installed — search for
`link.exe` under the Visual Studio folder to check for yourself.)

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

## Installer vs standalone

`cargo build --release` produces a **standalone, portable** `kinvt-study.exe`
(~3.4 MB) that needs no installation — copy it anywhere and run it.

`cargo tauri build` additionally wraps it in an NSIS installer, but that step
downloads NSIS from GitHub at bundle time and will fail with
`failed to bundle project 'timeout: global'` on a restricted or slow network.
That failure affects only the installer; the `.exe` itself is already built
and fully working by that point — look for
`Built application at: …/kinvt-study.exe` earlier in the output.
