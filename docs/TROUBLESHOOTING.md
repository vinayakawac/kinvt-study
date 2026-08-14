# Troubleshooting

## No quiz popup ever appears

1. Open the settings sidecar (toolbar icon) and check **Quiz popups** is toggled on.
2. Check **at least one Library topic is selected** — if all checkboxes are off, `buildQuiz()` returns `null` and nothing shows, by design (see [ERROR_HANDLING.md](ERROR_HANDLING.md)).
3. Check `chrome://extensions` → the extension's **service worker** → click "service worker" to open its console → run `chrome.alarms.getAll()`. You should see `tpq-popup` with a `periodInMinutes` matching your Settings interval. If it's missing, toggle **Quiz popups** off and back on to force `ensureAlarm()` to re-create it.
4. Auto-popups only inject into **http(s)/file** tabs (`overlay.js`'s guard) or fall back to a popup window. If your active tab was a `chrome://` or extension-store page at the moment the alarm fired, the overlay silently skips that cycle — wait for the next one, or click **Quiz me now** instead.
5. If injection AND the window fallback both silently fail (rare), nothing will visibly happen. Check the service worker console for a rejected promise around `showQuiz()`.

## The quiz opens in a separate floating window instead of over the page

If you get a small window with its own title bar/minimize/close buttons instead of a translucent card injected into your current tab, that's the `quiz-window.html` fallback — it's supposed to only appear on restricted pages (`chrome://`, extension stores) where injection is blocked. Seeing it on an ordinary webpage was a real bug on some browsers/forks (Zen Browser included) whose sidebar is implemented as its own top-level window, confusing the "which window am I injecting into" lookup. Fixed via `getActiveContentTab()` — see [ERROR_HANDLING.md](ERROR_HANDLING.md#4-quizzes-opened-as-a-floating-popup-window-instead-of-an-in-page-overlay). If it recurs on a browser we haven't tested against, check what `chrome.windows.getLastFocused({windowTypes:['normal']})` actually returns there — it may need a different `windowTypes` value or a different fallback strategy for that browser's window model.

## The card appears on the page but looks completely broken/unstyled (huge icon, no layout)

This was a real bug — `ui-core.js`'s style-injection helper checked the wrong element for a shadow root, so on a real injected overlay (as opposed to the fallback window), the card's CSS never actually reached inside the shadow root it was rendered in. Fixed — see [ERROR_HANDLING.md](ERROR_HANDLING.md#5-the-overlays-own-styles-never-reached-inside-its-shadow-root). Test with `test-harness/overlay-preview.html`, which is the only preview page that renders through a real `attachShadow()` root the way `overlay.js` actually does in production — the other preview pages can't catch this class of bug.

## "Quiz me now" works once, then does nothing on later clicks

This was a real bug — the auto-popup's "don't stack multiple quizzes" guard could get stuck if the first quiz never sent back `QUIZ_CLOSED`/`QUIZ_RESULT`, silently blocking every subsequent manual click for up to 5 minutes with no visible error. Fixed: "Quiz me now" now always forces a fresh quiz regardless of that guard (see [ERROR_HANDLING.md](ERROR_HANDLING.md#3-quiz-me-now-could-silently-stop-working-after-the-first-click)). If it recurs, check that `sidepanel.js`'s `startNow` handler sends `{ type: 'START_QUIZ' }` and that `background.js`'s handler for it calls `showQuiz(true)`, not the unforced `showQuiz()`.

## The quiz card closes almost instantly / can't click anything

This was a real bug in an earlier version — `ui-core.js` was treating the "auto-close after N seconds" setting as milliseconds, so the card closed in ~45ms instead of 45 seconds. It's fixed (see [ERROR_HANDLING.md](ERROR_HANDLING.md#1-auto-close-timer-used-seconds-as-milliseconds)). If you see this again after a code change, check `durationMs` in `ui-core.js`'s `create()` is actually `cfg.durationSec * 1000`, not the raw settings value.

## The quiz window (fallback popup) shows "No quiz queued right now" even though one should be pending

This was also a real bug — the payload-fetch fallback (service worker → `storage.session`) could get short-circuited by a falsy/error response from the primary path (see [ERROR_HANDLING.md](ERROR_HANDLING.md#2-fallback-payload-fetch-was-unreachable-in-practice)). Also fixed, but if it recurs: check `getPayload()` in `overlay.js`/`quiz-window.js` — a `done(v)` call should only ever settle the promise on a **truthy** `v`; anything falsy should fall through to the next fallback tier, not resolve immediately.

## A settings toggle doesn't visually update (e.g. the glass intensity slider stays showing when it shouldn't)

Check for a `[hidden]` vs. `display: flex/grid` CSS specificity conflict. Any element toggled via the `hidden` HTML attribute needs `[hidden] { display: none !important; }` declared somewhere in that stylesheet — a class like `.row { display: flex; }` at equal specificity to the browser's default `[hidden]` rule will win unpredictably depending on stylesheet order, and can make a "hidden" element stay visible. `sidepanel.css` already has this rule at the top; if you add a new stylesheet, make sure it does too.

## The sidecar looks cut off / not responsive in a narrow sidebar or side panel

`sidepanel.css` previously had `html { min-width: 320px; }`, which forced the whole page to refuse to shrink below 320px — if the actual Chrome side panel or Firefox sidebar was resized narrower than that (or a fork like Zen Browser defaults to a narrower one), content just got clipped instead of reflowing to a single column. Fixed by removing that hard floor and letting the two-pane grid (`grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr))`) actually collapse to one column below 320px, plus making `.row` wrap and the `<select>`/range inputs shrink instead of holding a fixed width. If a similar clipping issue shows up again, check for any fixed `px` width/min-width on a top-level element that doesn't have a corresponding `max-width: 100%` or wrap behavior.

## Dropdown menu (`<select>`) options are washed-out/hard to read

Firefox (unlike Chrome, which always renders `<select>` popups with the OS native theme regardless of CSS) partially honors `color`/`background` on `<option>` elements. Without explicit styling there, it falls back to the OS light theme for the popup list even though the closed `<select>` itself is styled dark — producing light-gray-on-white text that clashes with the rest of the UI. Fixed with explicit `select option { background; color; }` rules in `sidepanel.css` (dark and light theme variants). This only affects Firefox-family browsers; Chrome's native dropdown styling can't be overridden by CSS at all, by design.

## Library topics don't reflect recent content updates

The daily background sync (`syncContent()`) only runs once every 24 hours per install, plus once immediately on install. To check its status:

- Open the sidepanel — the Library section shows "Library last synced X ago" (or "No sync yet").
- In the service worker console: `chrome.storage.local.get('lastSyncAt').then(console.log)`.
- To force a sync during development, call `syncContent()` directly from the service worker console (it's a top-level function in `background.js`, so it's available as a global there).
- If sync keeps failing, check the repo is reachable: `curl https://raw.githubusercontent.com/vinayakawac/kinvt-study/main/library.json` should return JSON, not a 404.

See [CONTENT_SYNC.md](CONTENT_SYNC.md) for the full sync mechanics.

## The extension seems to be using CPU/battery even when idle

This shouldn't happen by design (see [ARCHITECTURE.md](ARCHITECTURE.md#why-it-stays-cheap-on-cpu)). To verify:

- `chrome://extensions` → the service worker should show as **inactive** most of the time, not persistently running.
- Chrome Task Manager (`Shift+Esc`) → the extension's process should sit near 0% CPU when no quiz card is visible.
- If you've added code, check you haven't introduced a `setInterval`/polling loop, or a content script that runs on every page load (`overlay.js` should only ever be injected on-demand via `chrome.scripting.executeScript`, never declared in `manifest.json`'s `content_scripts`).

## Testing without loading the extension in a real browser

Use `test-harness/` — see [SETUP.md](SETUP.md#local-preview-no-browser-extension-loading-required). It mocks the `chrome`/`browser` API well enough to exercise the real, unmodified source files (quiz card rendering, sidepanel interactivity, and `background.js`'s `buildQuiz()`/`syncContent()` logic) without needing `chrome://extensions` or a real service worker — useful in sandboxed/headless environments where loading an unpacked extension isn't possible.

## Firefox-specific issues

- Temporary add-ons (`about:debugging` → "Load Temporary Add-on…") are removed on restart — this is expected, not a bug.
- The settings sidecar uses `sidebar_action` on Firefox instead of Chrome's `sidePanel` API — both point at the same `sidepanel.html`, so behavior should be identical; if the sidebar doesn't open on icon click, check `background.js#openSidecar()`'s Firefox branch (`api.sidebarAction.toggle()`).

### "background.service_worker is currently disabled. Add background.scripts."

Seen when loading as a temporary add-on in Firefox or a Firefox fork (Zen Browser, LibreWolf, etc). `background.service_worker` support in MV3 is still behind a flag in many Firefox builds — even fairly recent ones — regardless of the `strict_min_version` declared in `browser_specific_settings.gecko`. It isn't specific to old versions; it depends on that flag being enabled.

Fixed by declaring **both** keys in `manifest.json`:

```json
"background": {
  "service_worker": "background.js",
  "scripts": ["background.js"]
}
```

Chrome/Edge use `service_worker`; Firefox falls back to `scripts` (a classic non-persistent background page) when the service-worker flag isn't enabled. `background.js` itself needs no changes for this — it's a single plain script either way, no `importScripts`/ES modules to reconcile between the two loading modes.

If you still see the error after this change, check `about:config` for `extensions.background.service_worker.enabled` — some builds need it flipped on explicitly, or just rely on the `scripts` fallback working regardless.
