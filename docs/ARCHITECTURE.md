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

There are two independent ways a quiz shows up, and they diverge deliberately:

**Automatic (alarm-triggered), or a restricted page**
1. `chrome.alarms` fires the popup alarm.
2. `background.js#buildQuiz()` reads settings (`selectedCategories`/`topics`), loads each selected topic's bundled `data/*.json`, merges in any synced overrides (see below), shuffles, and slices to `perQuiz` questions.
3. The payload is stashed in `chrome.storage.session` (`pendingQuiz`) and a "showing" guard timestamp is set so multiple alarms can't stack popups.
4. `background.js` finds a real browser tab (`getActiveContentTab()`, deliberately not just "last focused window" — see [ERROR_HANDLING.md](ERROR_HANDLING.md#4-quizzes-opened-as-a-floating-popup-window-instead-of-an-in-page-overlay)) and tries `chrome.scripting.executeScript` on it to inject `ui-core.js` + `overlay.js`. If that throws (restricted page, no tab found), it opens `quiz-window.html` instead — this is the *only* surface where a real window ever appears.
5. The injected/opened surface asks the service worker for the payload via `chrome.runtime.sendMessage({type:'GET_PENDING_QUIZ'})`, with a `storage.session` read as a fallback if that doesn't return a payload in time.
6. Answers are recorded locally; when the quiz finishes, `QUIZ_RESULT` is sent back to update `stats` in `storage.local`, which the sidepanel listens for live via `storage.onChanged`.

**Manual ("Quiz me now" in the sidecar)**
1. `sidepanel.js` sends `{ type: 'BUILD_QUIZ' }`; `background.js` just calls `buildQuiz()` and returns the payload directly — no tab lookup, no injection, no window, no "showing" guard to get stuck on.
2. `sidepanel.js` hides its settings sections (`#settingsView`) and renders the card straight into its own page (`#inlineQuiz`) via `window.TPQ_UI.create(...)`, using the same `ui-core.js` the other two surfaces use. No shadow root is needed here — the sidecar is already an isolated extension page.
3. On finish, `sidepanel.js` sends `QUIZ_RESULT` itself (same message, same handler). On close, the settings sections reappear.

This means "Quiz me now" always works regardless of what tab is active or focused — including from `chrome://extensions`/`about:debugging` — since it never needs a tab at all.

## Background content sync (no user interaction)

Once a day, `background.js#syncContent()` fetches each topic's JSON straight from `raw.githubusercontent.com/vinayakawac/kinvt-study/main/data/<file>.json` and merges it into `storage.local.remoteLibrary` by question `id`. `buildQuiz()` merges that on top of the bundled JSON every time it runs. No permission prompt is needed for this because `<all_urls>` is already a required (not optional) permission for overlay injection, so the fixed GitHub host is already covered.

See [CONTENT_SYNC.md](CONTENT_SYNC.md) for the full mechanics and how to publish new questions.

## Why it stays cheap on CPU

1. **No polling, no loops.** Scheduling is the browser's own `alarms` API — the service worker sleeps between events; Chrome literally terminates it when idle.
2. **One quiz = one timer.** The auto-close countdown is a single `setTimeout`; the progress bar is one CSS `width` transition (no `requestAnimationFrame`, no `setInterval`).
3. Two listeners total in the overlay (one delegated click, one keydown), removed on close, and the whole host node is deleted from the DOM.
4. Animations run once (`transform`/`opacity` only) and stop. `backdrop-filter` is the only continuous GPU cost and only exists while the card is visible.
5. No AI, no trackers — everything runs from local JSON plus one small daily background fetch.
