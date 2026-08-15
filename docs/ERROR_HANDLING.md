# Error handling

The app is built to fail *quietly and safely*. A failed sync, a hotkey another
app already owns, a malformed topic file — none of these should produce a
dialog or a dead app. They should mean "no quiz this time" or "use the bundled
questions".

## Principles

1. **Every network call has a local fallback.** Questions always exist offline
   in `ui/data/`; the daily sync can only add to them.
2. **Degrade, don't abort.** A broken topic file is skipped and the rest of the
   quiz still builds. A hotkey that cannot be registered is logged; the tray
   and timer keep working.
3. **Never show an empty card.** If no topics are selected or no bank loads,
   `buildQuiz()` returns `null` and nothing is shown at all.
4. **Nothing blocks on the network.** Sync runs independently of quiz building.

## Where this lives

| Location | On failure |
|---|---|
| `quiz-engine.js#buildQuiz()` | A topic whose JSON fails to load is skipped. If no topic yields questions, returns `null` and no card appears. |
| `quiz-engine.js#syncContent()` | Per-topic fetch failure returns `null` for that topic; the bundled copy stays authoritative. Whole-sync failure resolves `false`. |
| `main.rs` global shortcut | Registration failure is logged, not fatal — the tray and interval timer are unaffected. |
| `main.rs` tray icon | Missing default window icon returns an error from `setup()` rather than `.unwrap()`-ing. Under `windows_subsystem="windows"` with `panic=abort` an unwrap would abort with no console and no message. |
| `app.js` timer | One `setTimeout`, re-armed after each fire. Never `setInterval`, so a slow or failed quiz build cannot stack timers. |

## Bugs this project actually hit

Kept because each one is a class of mistake, not a one-off.

### Silence is the real bug

Several of the worst failures reported success at every step:

- **Tauri capabilities.** `event.emit`/`listen` were denied without a
  capabilities file, but `invoke('show_quiz')` succeeded — so the app showed
  an empty transparent window and nothing indicated a problem.
- **The overlay's payload handshake** (in the extension this grew out of)
  fetched its own data and returned silently when it came up empty — while the
  caller had already seen injection succeed, so it never fell back.

**Lesson:** injecting or invoking successfully is not the same as the thing
*working*. If the success signal stops at "the call resolved", every failure
inside is invisible. Have the far side report its own outcome.

### Guarding on data you may not be allowed to read

Injection was skipped for every tab because the guard checked `tab.url`, and
`tab.url` is only populated when the permission the injection itself needs has
been granted. The check failed exactly when it mattered.

**Lesson:** a permission-gated field being absent means "not allowed to see
this", not "does not exist" — opposite actions. Prefer attempting the real
operation and handling its failure over pre-screening with metadata.

### Units and inline overrides

- The auto-close countdown treated seconds as milliseconds, so the card closed
  after ~45 ms. Nothing threw; it was just unusable.
- The card sets its glass colours **inline**, overriding the stylesheet, and
  those inline values still held the old palette after a rebrand — so the new
  colours were never visible at runtime despite the CSS being correct.

**Lesson:** when a value crosses a unit boundary, or when JS overrides CSS,
grep for *every* place it is set. A correct stylesheet proves nothing if
something writes over it.

### Test doubles that drift

`_preview.html` kept its own copy of the window CSS and fell out of step with
`index.html`, so a layout fix "passed" against markup the app never renders.
Earlier, extension preview pages rendered the card into a plain `<div>` while
production used a real shadow root — structurally unable to catch a
shadow-DOM styling bug.

**Lesson:** a test double that has drifted from production is worse than no
test, because it produces confident false passes. If the real thing uses a
shadow root, a transparent window, or a separate stylesheet, the test must too.

## If you are adding async logic

- Return `null`/`false` for "did not work, try the next thing"; reserve throwing
  for genuinely unexpected states.
- Writing "try A, fall back to B"? Write the test that *forces A to fail*. Both
  fallback bugs above hid in exactly the path nobody exercised.
- Keep failures local: one broken topic must not break the others; a failed
  sync must not break the bundled content.
