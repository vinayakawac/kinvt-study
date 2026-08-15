# Architecture

```
tray icon / Ctrl+Shift+Q / interval timer
        │
        ▼
main.js (Electron main process)
   ├─ quiz window: transparent · frameless · always-on-top · skipTaskbar
   ├─ tray menu (Quiz me now · Settings · Quit)
   ├─ global shortcut
   └─ IPC: show_quiz · hide_quiz · resize_quiz · open_settings
        │  (preload.js bridges these as window.__TAURI__)
        ▼
ui/ — the whole product
   ├─ ui-core.js      the glass quiz card (shared, unchanged since the extension)
   ├─ quiz-engine.js  settings, stats, topic filtering, shuffling, content sync
   ├─ app.js          quiz window controller + interval timer
   ├─ settings.js     settings window
   ├─ library.json    16-topic registry
   └─ data/*.json     336 bundled questions
```

## Why the main process owns so little

Only window, tray and hotkey plumbing. Everything a user would call "the app"
— building a quiz, filtering topics, scoring, settings — lives in `ui/`, which
is plain HTML/CSS/JS. That keeps one implementation of the product rather than
splitting it across a native layer and a web layer, and it is why the same
`ui/` folder serves both the Electron and Tauri builds.

## Two shells, one UI

| | Electron (`main.js`) | Tauri (`tauri/`) |
|---|---|---|
| Size | ~150 MB | ~6 MB |
| Toolchain | Node + npm only | Rust **and an MSVC linker** |
| Status | what ships today | builds if you have the toolchain |

`preload.js` deliberately exposes the same `window.__TAURI__` shape Tauri
provides, so `ui/` runs unmodified under either. Branching on the runtime
inside the UI would have meant two code paths through the part users see.

## Why a desktop app rather than a browser extension

The popup needed four things at once: transparent, frameless, always-on-top,
and independent of the browser. An extension can manage at most three:

- An extension popup window **cannot be transparent** (an OS window has an
  opaque backing surface, and there is no page behind it to show through) and
  **cannot drop its title bar** — browsers enforce this so pages cannot
  impersonate native windows.
- An in-page overlay can be transparent and chromeless, but **lives in one
  tab's DOM**, so it dies when you switch tabs or minimise the browser.

Browser security boundaries, not missing features. A native window has none of
them. See [ERROR_HANDLING.md](ERROR_HANDLING.md) for the bugs found along the
way, several of which came from fighting those limits before accepting them.

## Low-CPU discipline (carried over from the extension)

1. **One timer.** A single `setTimeout` for the next popup, re-armed after each
   fire — never `setInterval` polling.
2. **One quiz = one countdown.** The auto-close bar is a CSS transition, not a
   rAF loop.
3. Two listeners in the card (delegated click, keydown), removed on close.
4. `backdrop-filter` is the only continuous GPU cost, and only while a card is
   visible. The window is hidden the rest of the time.
