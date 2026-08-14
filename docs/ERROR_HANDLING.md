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

## If you're adding new async logic here

- Prefer returning `null`/`undefined`/`false` for "didn't work, try the next thing" and reserve throwing for genuinely unexpected states.
- If you're writing a "try A, then fall back to B" pattern, write a test (see `test-harness/`) that actually forces A to fail, not just checks that A succeeding works. That's precisely the case the two bugs above hid in.
- Keep failures local — a broken topic file shouldn't break other topics; a failed sync shouldn't break the bundled fallback; a failed injection shouldn't break the popup-window fallback.
