# Setup

## Prerequisites

- Node.js (any recent version — used only for the build script, no runtime dependencies)
- Chrome, Edge, or Firefox for testing
- Git, if you want to edit and push the synced content repo ([kinvt-study](https://github.com/vinayakawac/kinvt-study))

## Build

```bash
npm run build
```

This copies `src/` into `build/`. There's nothing to configure — a single `manifest.json` works across Chrome, Edge, and Firefox, so there's no per-browser step.

You can also skip the build and load `src/` directly during development; `npm run build` just gives you a clean, disposable copy for distribution.

## Load unpacked — Chrome / Edge / Brave

1. Go to `chrome://extensions` (Edge: `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select `build/` (or `src/` for faster iteration — edits to most files take effect on next popup/reload without a full rebuild; changes to `manifest.json` or `background.js` need a reload from `chrome://extensions`).
5. Pin the icon to your toolbar. Clicking it opens the settings sidecar.

A welcome quiz pops up about a minute after install so you see the card immediately.

## Load unpacked — Firefox

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` inside `build/` or `src/`.
4. Clicking the toolbar icon opens the Firefox sidebar with the same settings panel.

Note: temporary add-ons are removed when Firefox restarts. For a permanent install you'd need to sign it via addons.mozilla.org, or run Firefox Developer Edition with `xpinstall.signatures.required=false`.

## Local preview (no browser extension loading required)

`test-harness/` contains standalone pages that load the real, unmodified source files with a mocked `chrome`/`browser` API, useful for quick visual/behavioral checks without reloading an actual extension:

```bash
node test-harness/serve.js
```

Then open:

- `http://localhost:8792/test-harness/quiz-card-preview.html` — the quiz card UI in isolation (theme/glass preset switcher included)
- `http://localhost:8792/test-harness/sidepanel-preview.html` — the settings sidecar
- `http://localhost:8792/test-harness/quiz-window-preview.html` — the fallback popup window
- `http://localhost:8792/test-harness/background-test.html` — exercises `background.js`'s `buildQuiz()` and `syncContent()` directly and prints the result as JSON

See [ARCHITECTURE.md](ARCHITECTURE.md) for how these map to the real extension, and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if something doesn't behave as expected.

## Editing the question library

See [CONTENT_SYNC.md](CONTENT_SYNC.md) — questions live in `src/data/*.json` (bundled, ships with the extension) and are mirrored at the repo root of [kinvt-study](https://github.com/vinayakawac/kinvt-study) (what installed extensions sync from daily).
