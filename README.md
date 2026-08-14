# Translucent Pop — Smart Quiz

**A translucent, near-zero-CPU MCQ quiz popup for competitive-exam prep — local-first, no AI.**

> Manifest V3 · Chrome/Edge/Firefox (single unified manifest) · 336 bundled questions across 16 topics (GK, UPSC, KPSC/KAS, SSC, Banking, Railways, Defence, Current Affairs & more) · library also syncs automatically in the background, no clicks required

While you browse, a frosted-glass card periodically slides up over the page you're reading and asks you 1–5 MCQs. Answer → see the explanation → next. Click the toolbar icon to open the **settings sidecar** — a side panel that stays open beside your browsing while you tune the library, or launch a quiz instantly.

## Two ways to get quizzed

- **Toolbar click** → opens the settings sidecar (Chrome/Edge side panel, Firefox sidebar, or a small window as a last-resort fallback). "Quiz me now" launches one immediately.
- **Periodic auto-popup** — every 15 min–2 h (configurable), a translucent glass card is injected into the tab you're viewing via `chrome.scripting`. Falls back to a small standalone popup window on pages where injection is blocked (`chrome://`, extension stores).

## Content: bundled + auto-synced, no interaction required

Questions ship bundled as local JSON (100% functional offline) and also sync automatically, once a day, from a public GitHub repo — [vinayakawac/kinvt-study](https://github.com/vinayakawac/kinvt-study). No button, no permission prompt: the repo's raw-content host is already covered by the `<all_urls>` permission the extension needs for overlay injection anyway. If a sync ever fails (offline, GitHub unreachable), the bundled JSON is always there as a fallback — the library never ends up empty.

To add or refresh questions: edit a file under `kinvt-study/data/` on GitHub and push. Every installed copy picks it up within a day, merged in by question `id` (same id updates that question, new id adds one).

## Why it stays cheap on CPU

1. **No polling, no loops.** Scheduling is the browser's own `alarms` API — the service worker sleeps between events.
2. **One quiz = one timer.** The auto-close countdown is a single `setTimeout`; the progress bar is one CSS `width` transition.
3. Two listeners total in the overlay (click + keydown), removed on close; the whole host node is deleted from the DOM.
4. `backdrop-filter` is the only continuous GPU feature and only exists while the card is visible.
5. No AI, no trackers — everything runs from bundled JSON plus one small daily background fetch.

## Load it for testing

```bash
npm run build
```

This copies `src/` into `build/` (a single manifest works for every browser, so there's nothing to swap per target).

**Chrome / Edge / Brave**: `chrome://extensions` → enable Developer Mode → "Load unpacked" → select `build/` (or `src/` directly for faster iteration without rebuilding).

**Firefox**: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select `manifest.json` inside `build/` or `src/`.

## Project layout

```
src/
├── manifest.json        Single MV3 manifest (Chrome + Firefox)
├── background.js        Scheduler, quiz builder, daily content sync, stats
├── library.json          16-topic registry — add a topic here + one data file, no other code changes
├── data/*.json           Question banks (336 questions across 16 topics)
├── ui-core.js            Shared glass quiz card (used by both the overlay and the fallback window)
├── overlay.js            Content script → shadow-DOM translucent overlay
├── quiz-window.html/js   Fallback popup window (chrome://, store pages, injection failures)
├── sidepanel.html/css/js Settings sidecar (side panel / sidebar / windowed fallback)
└── icons/                16/48/128 PNGs
scripts/build.js          Copies src/ into build/
test-harness/             Local preview pages (quiz card, sidepanel, background logic) — mocks the
                           chrome.* API so the real source files can be exercised in a plain browser tab
```

## Adding a new topic (no code needed)

1. Create `src/data/your-topic.json` with `{ "name", "description", "questions": [...] }` — each question needs `id`, `category`, `question`, `options`, `answer` (0-based correct index), optional `explanation`/`topic`/`difficulty`.
2. Add one entry to `src/library.json` (`id`, `label`, `icon`, `group`, `blurb`, `file`).
3. Rebuild — it appears in the Library with a checkbox automatically.

## Verifying low resource usage

- `chrome://extensions` → the service worker should show as inactive between alarm fires.
- Chrome Task Manager (`Shift+Esc`) → ~0% CPU for the extension when idle.
- DevTools → Elements panel: the overlay's shadow-root host node only exists transiently while a popup is showing.

## Privacy

Settings, stats, and the quiz payload live in the browser's local extension storage. No accounts, no analytics. The only network activity is the once-daily content sync against the public `kinvt-study` repo.

## Documentation

See [docs/](docs/) for setup, architecture, the content-sync mechanics, a full permissions breakdown, error-handling principles, troubleshooting, and FAQ.
