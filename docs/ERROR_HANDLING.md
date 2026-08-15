# Error Handling

The extension is built to fail *silently and safely* — a broken fetch, a missing permission, or an unreachable service worker should never surface a visible error to the user; it should just mean "no quiz this time" or "the bundled content is used instead."

## Principles

1. **Every network call has a local fallback.** Question data is always available offline from `src/data/*.json`; the daily GitHub sync can only add to that, never leave the user with nothing.
2. **Every `try`/`catch` degrades gracefully, not loudly.** There are no user-facing error toasts or console-only failures the user would need to notice. If a topic's JSON is malformed, that topic is skipped and the rest of the quiz still builds.
3. **Nothing blocks on network.** The background sync (`syncContent()`) runs independently of quiz-building; if GitHub is unreachable, `buildQuiz()` still runs immediately off the bundled JSON.

## Where this shows up in the code

| Location | Behavior on failure |
|---|---|
| `background.js#buildQuiz()` | If `library.json` fails to load, or a topic's `data/*.json` fails to fetch/parse, that topic is skipped (`catch` swallows the error) rather than failing the whole quiz. If **no** topic has any questions, `buildQuiz()` returns `null` and no popup appears. |
| `background.js#fetchRemoteTopic()` | Any fetch/parse failure (offline, GitHub down, malformed JSON) returns `null` for that topic; `syncContent()` simply doesn't update `remoteLibrary` for it, leaving the bundled version as-is. |
| `background.js#showQuiz()` | Injection failure (`chrome.scripting.executeScript` throwing on a restricted page) falls through to opening `quiz-window.html` instead. If even that fails, it fails silently — no error surfaced. |
| `overlay.js` / `quiz-window.js` — `getPayload()` | Three-tier fallback: ask the service worker → fall back to a `storage.session` read 400ms later → give up quietly after 2.5s and show an empty state. See "A real bug we found" below for why the *order* of these fallbacks matters. |
| `sidepanel.js#init()` | If `storage.local.get`/`library.json` fetch fails, an inline error message is appended to the page — this is the one place a failure is shown, since it's a page the user is actively looking at and would otherwise see a blank panel. |

## A real bug we found and fixed here

While migrating this extension, two genuine correctness bugs surfaced through testing — both worth documenting since the failure mode was silent (nothing threw; the UI just quietly did the wrong thing).

### 1. Auto-close timer used seconds as milliseconds

`ui-core.js` computed `durationSec` from settings (e.g. `45`, meaning 45 seconds) but passed it directly into `setTimeout(fn, durationSec)` and the CSS `transition` duration — both of which expect **milliseconds**. The quiz card was auto-closing after ~45 **milliseconds** instead of 45 seconds, making it effectively unusable (it vanished before a human could click anything). Fixed by computing `durationMs = durationSec * 1000` once, and using that everywhere a duration is needed.

**Lesson**: any time a value crosses a unit boundary (seconds ↔ milliseconds, especially with a variable name that doesn't make the unit explicit at the call site), double check both ends. A code review alone didn't catch this — it needed an actual click to fail.

### 2. Fallback payload fetch was unreachable in practice

`getPayload()` in both `overlay.js` and `quiz-window.js` is designed as: ask the service worker first, and fall back to reading `storage.session` directly 400ms later "in case the worker went away." The bug: the primary path's `.then()`/`.catch()` handlers called `done(res && res.pendingQuiz)` or `done(null)` unconditionally, and `done()` used first-write-wins semantics (`if (!settled) { settled = true; resolve(...) }`). That meant *any* falsy response or error from the primary path — not just success — permanently settled the promise, so the storage fallback scheduled 400ms later could never actually run; it was dead code in the one situation it existed for.

Fixed by splitting into two functions: `done(v)` only settles on a **truthy** payload, and a separate `giveUp()` is the only thing that can settle with `null` (called only after the final 2.5s timeout). A falsy/error result from either the message path or the early storage attempt now correctly falls through to the next tier instead of giving up early.

**Lesson**: a "primary path, then fallback" pattern needs the primary path's *failure* to be distinguishable from its *success* at the point where you decide whether to keep trying. Collapsing both into a single `done()` call silently deletes the fallback.

### 3. "Quiz me now" could silently stop working after the first click

`background.js#showQuiz()` sets a `quizShowing` timestamp in `storage.session` *before* it knows whether a quiz card actually ends up visible, as a guard against the auto-popup alarm stacking multiple cards if it fires again before the last one was answered. That guard is checked on every call to `showQuiz()`, including ones triggered by the sidepanel's "Quiz me now" button. If the first quiz never sends back `QUIZ_CLOSED`/`QUIZ_RESULT` — e.g. injection silently no-op'd because the tab's viewport was too small (`overlay.js`'s `innerWidth < 340 || innerHeight < 380` guard), or the card was dismissed some other way — the guard stays "stuck" for up to `SHOWING_TTL_MS` (5 minutes), during which every subsequent "Quiz me now" click does nothing at all, with no feedback that anything went wrong.

Fixed at the time by giving `showQuiz()` an optional `force` parameter, so an explicit "Quiz me now" click always bypassed the guard rather than risk silently no-op'ing.

**Lesson**: a "don't stack automatic events" guard and "the user explicitly asked for this" are different situations — collapsing them into the same code path means a stuck guard state silently defeats deliberate user action, with no visible error to explain why.

*Superseded by §6 below*: "Quiz me now" no longer calls `showQuiz()` at all, so this specific guard can no longer affect it either way. `showQuiz()`'s `force` parameter still exists and is harmless, but is currently unused — nothing calls `showQuiz(true)` anymore.

### 4. Quizzes opened as a floating popup window instead of an in-page overlay

`showQuiz()` looked up a tab to inject into via `chrome.tabs.query({ active: true, lastFocusedWindow: true })`. That resolves to whatever window the browser considers "last focused" — normally the browser window you're looking at. But some browsers/forks (reported on Zen Browser) implement the settings sidebar as its own top-level window rather than as part of the main browser window. Clicking "Quiz me now" from inside that sidebar can make "last focused window" mean the sidebar's own window, which has no `http(s)` tabs in it at all — the tab lookup silently comes back empty, injection is skipped, and `showQuiz()` falls through to the `quiz-window.html` popup-window fallback every time, even though a perfectly good browser tab was open the whole time.

Fixed with `getActiveContentTab()`: it explicitly asks for a `'normal'`-type window via `chrome.windows.getLastFocused({ windowTypes: ['normal'] })` before querying that window's active tab, sidestepping sidebar/panel/popup windows entirely. Falls back to a broader `chrome.tabs.query({ active: true, windowType: 'normal' })` if that first lookup fails for any reason.

**Lesson**: "last focused window" is not the same thing as "the window with the content tab I want," especially once a browser has more than one kind of top-level window (a sidebar, a picture-in-picture window, a detached panel). Be explicit about the window *type* you actually need rather than relying on focus order.

*Also relevant after §6 below*: "Quiz me now" was briefly changed to skip tab lookup entirely, then changed back — it now shares this exact `getActiveContentTab()` call with the automatic popup via `tryInjectOverlay()`, so this fix applies to both triggers equally.

### 5. The overlay's own styles never reached inside its shadow root

`ui-core.js#addStyles(container, css)` decided where to attach the card's stylesheet by checking `container.shadowRoot`. That property only exists on an element that is *itself* a shadow host (i.e. something `attachShadow()` was called on directly) — but `container` is always a plain `<div>` living **inside** the shadow tree, never the host itself, in both call sites (`overlay.js` passes the `wrap` div appended to the shadow root; `quiz-window.js` passes a normal page `<div>`). `container.shadowRoot` was therefore always `undefined`, so the code took the "no shadow root" branch every time — attaching styles to the outer page's `document` instead. For `quiz-window.js` that's harmless, because there *is* no shadow root there; the page's own document is the right place. But for `overlay.js`, the styles landed on the **host page's** document (e.g. the real Wikipedia tab), which shadow DOM encapsulation specifically blocks from ever reaching content inside the shadow root. The result: the card rendered completely unstyled — most visibly, an inline 15×15px header icon with no size constraint rendered at its raw SVG intrinsic size, ballooning to fill most of the card and pushing the actual question down out of view.

This shipped without being caught because every prior test page (`quiz-card-preview.html`, `background-test.html`) rendered the card into a plain `<div>` with no shadow root at all — exercising the *fallback* branch's happy path, never the shadow-DOM branch that real page injection actually uses.

Fixed by using `container.getRootNode()` instead, which correctly walks up to the nearest root — the `ShadowRoot` if `container` sits inside one, or `document` otherwise — regardless of how many plain `<div>`s sit between `container` and that root. Both `Document` and `ShadowRoot` support `.adoptedStyleSheets` and `.appendChild()` identically, so the same code path now works correctly for both call sites.

Added `test-harness/overlay-preview.html`, which builds a real `attachShadow()` host on top of a mock "host page," to catch this exact class of bug going forward — the earlier test pages structurally couldn't have caught it no matter how much they were used, since they never involved a shadow root at all.

**Lesson**: a property check like `container.shadowRoot` is really asking "is `container` a shadow host," which is a much narrower question than "is `container` rendered inside a shadow tree." When testing DOM/styling code meant to work inside a shadow root, the test needs an *actual* shadow root, not a stand-in `<div>` — the two are not equivalent for anything CSS-scoping related, and a passing test against the stand-in proves nothing about the real path.

### 6. "Quiz me now" showed a real OS window, which no amount of styling can fix

Even after §4's tab-detection fix, testing from a restricted page (`chrome://extensions`, a debugging/management page) still opened `quiz-window.html` in a real `chrome.windows.create({type:'popup'})` window — correctly, by design, since injection into those pages is blocked by the browser itself for every extension, with no override available. But that window *always* carries a minimum OS-drawn title bar with minimize/close controls — every browser enforces this deliberately, so a page can never impersonate a chromeless native window for phishing purposes. No CSS or window-creation flag can remove it. That's a hard ceiling on how "just the card, nothing else" a real window can ever look, no matter how the card itself is styled.

The first fix attempt went too far in the other direction: it made "Quiz me now" skip tab injection entirely and always render inline in the sidecar, on the reasoning that the sidecar is already frameless so there's nothing to gain from injection. That missed what was actually wanted — the translucent overlay *on the page being browsed*, matching what the automatic popup already does correctly, not a card confined to the settings panel. The real fix keeps that as the preferred outcome and only changes what happens when it's *not achievable*.

`background.js`'s tab-injection logic was factored out into `tryInjectOverlay(quiz)`, shared by both triggers. The `BUILD_QUIZ` message handler behind "Quiz me now" calls `buildQuiz()` then `tryInjectOverlay()` just like the automatic path does, and returns `{ quiz, injected }`. `sidepanel.js` only renders the card into its own page (`#inlineQuiz`, via the same `ui-core.js` the other two surfaces use) when `injected` comes back `false` — i.e. only when there was genuinely no browser tab to inject into, such as when the active tab is a restricted page. It never opens a `chrome.windows.create()` window, which is the one thing both triggers avoid for a manual click.

**Lesson**: when a constraint turns out to be enforced by the platform itself (here: browsers refusing to let *any* extension draw a truly chromeless window), don't over-correct by removing the *good* part of the original behavior along with the bad part. The goal was never "no tab injection" — it was "no OS window." Conflating the two meant the first fix solved a problem the user didn't have (an ugly window) by breaking a feature they did want (the overlay showing up on their actual page).

### 7. Every injection was skipped on Firefox because `tab.url` was undefined

`tryInjectOverlay()` guarded injection with `typeof tab.url === 'string' && /^(https?|file):/i.test(tab.url)` — i.e. "only inject if I can see the URL and it looks injectable." Reasonable on Chrome. But `tab.url` is only populated when the host permission covering that tab is actually **granted**, and Firefox MV3 (Zen included) treats `host_permissions` as *opt-in*: `<all_urls>` being declared in the manifest doesn't mean it's held. Chrome grants it at install; Firefox waits for the user to approve it.

So on Firefox, `tab.url` came back `undefined` for every ordinary tab, the guard read that as "not injectable," and injection was skipped without ever being attempted — sending every single quiz to the fallback path. The symptom looked like the overlay feature was simply broken ("the quiz always opens in the side panel"), with nothing in the console, because from the code's perspective nothing failed: it correctly did what it was told, on wrong information.

Two-part fix:
- `tryInjectOverlay()` no longer treats *unknown* as *restricted*. It bails only when the URL is known **and** clearly not injectable; otherwise it attempts `executeScript` and lets that be the authority, since it throws precisely when injection isn't permitted.
- `sidepanel.js#ensureHostPermission()` calls `permissions.request({origins:['<all_urls>']})` when the permission isn't yet held, from inside the "Quiz me now" click handler — `permissions.request()` requires a user gesture, and a button click is one. On Chrome `contains()` is already true, so it's a no-op there.

**Lesson**: a permission-gated field being absent means "I'm not allowed to see this," not "this doesn't exist" — and those imply opposite actions (retry vs. give up). Guarding an operation on data whose *availability* depends on the very permission the operation needs makes the check fail exactly when it matters most. Prefer attempting the real operation and handling its failure over pre-screening with metadata you may not be entitled to read.

## If you're adding new async logic here

- Prefer returning `null`/`undefined`/`false` for "didn't work, try the next thing" and reserve throwing for genuinely unexpected states.
- If you're writing a "try A, then fall back to B" pattern, write a test (see `test-harness/`) that actually forces A to fail, not just checks that A succeeding works. That's precisely the case the two bugs above hid in.
- Keep failures local — a broken topic file shouldn't break other topics; a failed sync shouldn't break the bundled fallback; a failed injection shouldn't break the popup-window fallback.
