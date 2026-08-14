# Quiz Pop — Exam Prep MCQs

A translucent popup quiz extension for General Knowledge, UPSC, and KPSC/KAS
exam prep. No AI, no accounts. The question bank ships bundled as JSON and
also syncs automatically, once a day, from a public GitHub repo
([vinayakawac/kinvt-study](https://github.com/vinayakawac/kinvt-study)) — no
clicks required. The repo's raw-content host is declared as a fixed manifest
permission, so no runtime permission prompt is needed for this either. If the
sync ever fails (offline, GitHub unreachable), the bundled JSON is always
there as a fallback — the extension never ends up with zero questions.

To add or update questions: edit a file under `kinvt-study/data/` on GitHub
and push. Every installed copy of the extension picks it up within a day,
merged in by question `id` (same id updates that question, new id adds one).

## Two ways to get quizzed

- **Click the toolbar icon** any time for a translucent MCQ popup.
- **Periodic auto-popup** — every N minutes (configurable in Settings), a
  small translucent overlay slides in over whatever page you're browsing with
  one question. It self-dismisses after you answer or after ~20s.

The auto-popup requires a one-time permission grant from the Settings page
(a browser requirement — background alarms can't inject scripts without an
explicit user-gesture-granted host permission). The extension asks for no
host permissions at install; it only escalates when you turn the feature on.

## Load it for testing

```bash
npm run build
```

This produces `build/chrome/` and `build/firefox/`.

**Chrome / Edge**: go to `chrome://extensions`, enable Developer Mode, click
"Load unpacked", select `build/chrome`.

**Firefox**: go to `about:debugging#/runtime/this-firefox`, click "Load
Temporary Add-on", select `build/firefox/manifest.json`.

You can also load `src/` directly (with the right manifest renamed to
`manifest.json`) for faster iteration without rebuilding.

## Adding a new category

1. Add a JSON file to `src/data/` with the same shape as the existing files
   (`id`, `category`, `question`, `options`, `correctAnswerIndex`, optional
   `explanation`/`difficulty`).
2. Add one entry to `src/core/categories.js`.
3. Rebuild. A checkbox for it appears automatically in Settings — no other
   code changes needed.

## Verifying low resource usage

- `chrome://extensions` → the service worker should show as inactive between
  alarm fires (no persistent background page).
- Chrome Task Manager (`Shift+Esc`) → ~0% CPU for the extension when idle.
- `chrome://extensions` → extension details → "Site access" should show no
  granted host permissions until you enable the auto-popup in Settings.
- DevTools → Elements panel on any page: the overlay's shadow-root host node
  only exists transiently while a popup is showing, never persists.

## Project layout

See `src/` — `core/` holds the shared quiz engine, storage, and category
registry used by every surface (popup, options, background). `background/`
contains the alarm scheduling and the self-contained overlay injection code.
`data/` holds the offline question banks. `scripts/build.js` packages
per-browser builds; `scripts/generate-icons.js` regenerates the placeholder
toolbar icons.
