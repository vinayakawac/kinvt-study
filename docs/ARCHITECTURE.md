# Architecture

## Surfaces

```
toolbar click ──► settings sidecar: sidepanel.html/css/js
                      │ storage.local {settings, stats}   ▲ live stats updates
                      ▼
background.js (service worker, sleeps when idle)
   ├─ alarms API ────────► fires on schedule (quiz popup + daily content sync)
   ├─ builds a quiz from library.json + data/*.json (+ any synced overrides)
   └─ tries overlay injection in the focused tab ◄──────┘
        │ success: ui-core.js + overlay.js → glass card in a shadow root
        └─ blocked: quiz-window.html → small popup window with the same card
```

## Files

| File | Role |
|---|---|
| `manifest.json` | Single MV3 manifest. `service_worker` background works on Chrome/Edge and Firefox 121+. Declares `side_panel` (Chrome/Edge) and `sidebar_action` (Firefox) pointing at the same `sidepanel.html`. |
| `background.js` | Everything event-driven: alarm scheduling, quiz building, the daily content sync, stats bookkeeping, and the message router other surfaces talk to. No polling, no persistent timers — see [ERROR_HANDLING.md](ERROR_HANDLING.md) for how it fails safe. |
| `library.json` | The topic registry — `{ id, label, icon, group, blurb, file }` per topic. This is the single source of truth for what topics exist; `sidepanel.js` renders checkboxes from it, `background.js` builds quizzes from it. |
| `data/*.json` | One file per topic: `{ name, description, questions: [...] }`. Each question is `{ id, category, topic, difficulty, question, options, answer, explanation }` — `answer` is the 0-based correct option index. |
| `ui-core.js` | The shared quiz card UI (`window.TPQ_UI.create(container, cfg)`). A plain (non-module) script so it can be injected as a content script or loaded as a normal page script. Used by both `overlay.js` and `quiz-window.js`. |
| `overlay.js` | Content script injected on-demand by `background.js` via `chrome.scripting.executeScript`. Builds a shadow-DOM host so the card is fully style-isolated from the page. Fetches its quiz payload from the service worker, falling back to `storage.session` — see [ERROR_HANDLING.md](ERROR_HANDLING.md). |
| `quiz-window.html/js` | Fallback surface when overlay injection fails (`chrome://` pages, extension store pages, restricted origins). Same card, same payload-fetch logic, in a small dedicated popup window. |
| `sidepanel.html/css/js` | The settings sidecar. Renders the library checkboxes, appearance controls (theme, glass preset/intensity), and live stats. Works as a Chrome/Edge side panel, a Firefox sidebar, or a windowed fallback for older browsers. |
| `icons/` | 16/48/128 px toolbar icons. |

## Data flow for one popup

Both the automatic alarm and "Quiz me now" want the same outcome — a translucent overlay injected into the tab the user is actually browsing — and share the injection logic to get there (`tryInjectOverlay()`). They differ only in what happens when that's not possible.

**Building + injecting (shared by both triggers)**
1. `background.js#buildQuiz()` reads settings (`selectedCategories`/`topics`), loads each selected topic's bundled `data/*.json`, merges in any synced overrides (see below), shuffles, and slices to `perQuiz` questions.
2. `tryInjectOverlay(quiz)` stashes the payload in `chrome.storage.session` (`pendingQuiz`), finds a real browser tab via `getActiveContentTab()` (deliberately not just "last focused window" — see [ERROR_HANDLING.md](ERROR_HANDLING.md#4-quizzes-opened-as-a-floating-popup-window-instead-of-an-in-page-overlay)), and tries `chrome.scripting.executeScript` on it to inject `ui-core.js` + `overlay.js`. Returns whether that succeeded.
3. The injected surface asks the service worker for the payload via `chrome.runtime.sendMessage({type:'GET_PENDING_QUIZ'})`, with a `storage.session` read as a fallback if that doesn't return a payload in time.
4. Answers are recorded locally; when the quiz finishes, `QUIZ_RESULT` is sent back to update `stats` in `storage.local`, which the sidepanel listens for live via `storage.onChanged`.

**When injection isn't possible** (restricted page, or no tab found) — the two triggers diverge:
- **Automatic (alarm-triggered)**: `showQuiz()` falls back to `chrome.windows.create()` opening `quiz-window.html` — a real, unavoidable OS window, since the alarm has no other surface to show anything on. This also carries a "don't stack multiple popups" guard (`SHOWING_KEY`) that only applies to this path.
- **Manual ("Quiz me now")**: the `BUILD_QUIZ` message handler returns `{ quiz, injected: false }` instead of ever opening a window. `sidepanel.js` renders the card directly into its own page (`#inlineQuiz`) via `window.TPQ_UI.create(...)` — the same `ui-core.js` the other two surfaces use, no shadow root needed since the sidecar is already an isolated extension page — hiding its settings sections (`#settingsView`) while the card is up and restoring them on close. On finish, `sidepanel.js` sends `QUIZ_RESULT` itself.

This means "Quiz me now" always shows *something* regardless of what tab is active — the translucent overlay on your actual page when a tab is available (the common case), or the same card rendered right in the sidecar when it isn't (e.g. from `chrome://extensions`) — and never opens an OS window either way.

## Background content sync (no user interaction)

Once a day, `background.js#syncContent()` fetches each topic's JSON straight from `raw.githubusercontent.com/vinayakawac/kinvt-study/main/data/<file>.json` and merges it into `storage.local.remoteLibrary` by question `id`. `buildQuiz()` merges that on top of the bundled JSON every time it runs. No permission prompt is needed for this because `<all_urls>` is already a required (not optional) permission for overlay injection, so the fixed GitHub host is already covered.

See [CONTENT_SYNC.md](CONTENT_SYNC.md) for the full mechanics and how to publish new questions.

## Why it stays cheap on CPU

1. **No polling, no loops.** Scheduling is the browser's own `alarms` API — the service worker sleeps between events; Chrome literally terminates it when idle.
2. **One quiz = one timer.** The auto-close countdown is a single `setTimeout`; the progress bar is one CSS `width` transition (no `requestAnimationFrame`, no `setInterval`).
3. Two listeners total in the overlay (one delegated click, one keydown), removed on close, and the whole host node is deleted from the DOM.
4. Animations run once (`transform`/`opacity` only) and stop. `backdrop-filter` is the only continuous GPU cost and only exists while the card is visible.
5. No AI, no trackers — everything runs from local JSON plus one small daily background fetch.
