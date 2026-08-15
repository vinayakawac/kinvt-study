# Kinvt-study — Smart Quiz

A translucent, always-on-top MCQ quiz popup for competitive-exam prep. It sits in your system tray and, on a schedule you choose, floats a frosted-glass card over whatever you're doing with 1–5 questions — General Knowledge, UPSC, KPSC/KAS, SSC, Banking and more, across 336 bundled questions in 16 topics. Local-first and no AI: every question is static JSON that ships with the app.

## Setup

Download the installer from Releases, or build it yourself — see
[docs/DESKTOP_BUILD.md](docs/DESKTOP_BUILD.md).

There are two shells over the same UI. **Tauri is what you want**; Electron
exists as a fallback for machines without a C++ toolchain.

| | Tauri | Electron |
|---|---|---|
| Executable | **3.3 MB** | 78 MB |
| Idle memory | **29 MB**, 1 process | 92 MB, 4 processes |
| Needs | Rust + MSVC linker | Node + npm only |

```bash
cd desktop/tauri && cargo build --release   # -> target/release/kinvt-study.exe
```

**Using it**

- Running the .exe opens **Settings** so you can see it started. Close that
  window and it keeps running in the tray — it does not quit.
- It lives in the **system tray** — right-click for *Quiz me now*, *Settings*,
  or *Quit*. On Windows 11 new tray icons are hidden in the overflow flyout:
  click the **`^`** chevron near the clock, and drag the icon out to pin it.
- Press **Ctrl + Shift + Q** from any application for a quiz on demand.
- Otherwise it pops up on its own every 15 minutes – 2 hours, configurable in Settings.

## Why a desktop app and not a browser extension

This started as a Chrome/Firefox extension. The popup needed to be transparent, frameless, always-on-top and independent of the browser — and a browser extension can't do all four:

- Extension popup windows **can't be transparent** (an OS window has an opaque backing surface and no page behind it to show through) and **can't drop their title bar** — browsers enforce that so pages can't impersonate native windows.
- An in-page overlay can be transparent and chromeless, but **lives in one tab's DOM**, so it dies when you switch tabs or minimise the browser.

Those are browser security boundaries, not missing features. A native window has none of them, so the app does what the extension structurally never could.

## Documentation

- [docs/DESKTOP_BUILD.md](docs/DESKTOP_BUILD.md) — building the .exe, toolchain prerequisites, previewing the UI without building.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the shell, the shared `ui/` folder, and why the shell owns so little.
- [docs/CONTENT.md](docs/CONTENT.md) — question schema, adding topics, the daily sync.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — nothing appears, card cut off, grey halo, build failures.
- [docs/ERROR_HANDLING.md](docs/ERROR_HANDLING.md), [docs/FAQ.md](docs/FAQ.md)

## License

MIT — see [LICENSE](LICENSE).
