# Kinvt-study — Smart Quiz

A translucent, always-on-top MCQ quiz popup for competitive-exam prep. It sits in your system tray and, on a schedule you choose, floats a frosted-glass card over whatever you're doing with 1–5 questions — General Knowledge, UPSC, KPSC/KAS, SSC, Banking and more, across 336 bundled questions in 16 topics. Local-first and no AI: every question is static JSON that ships with the app.

## Setup

Download the installer from Releases, or build it yourself:

```bash
cd desktop
cargo build --release
```

The executable lands in `desktop/target/release/`.

**Using it**

- It lives in the **system tray** — right-click for *Quiz me now*, *Settings*, or *Quit*.
- Press **Ctrl + Shift + Q** from any application for a quiz on demand.
- Otherwise it pops up on its own every 15 minutes – 2 hours, configurable in Settings.

## Why a desktop app and not a browser extension

This started as a Chrome/Firefox extension (kept in [extension-archive/](extension-archive/)). The popup needed to be transparent, frameless, always-on-top and independent of the browser — and a browser extension can't do all four:

- Extension popup windows **can't be transparent** (an OS window has an opaque backing surface and no page behind it to show through) and **can't drop their title bar** — browsers enforce that so pages can't impersonate native windows.
- An in-page overlay can be transparent and chromeless, but **lives in one tab's DOM**, so it dies when you switch tabs or minimise the browser.

Those are browser security boundaries, not missing features. A native window has none of them, so the app does what the extension structurally never could.

## Documentation

- [docs/DESKTOP_BUILD.md](docs/DESKTOP_BUILD.md) — build prerequisites, and how to preview the UI without building.
- [docs/](docs/) — architecture, content pipeline, error handling, troubleshooting, FAQ. Some pages still describe the extension; they are being ported.

## License

MIT — see [LICENSE](LICENSE).
