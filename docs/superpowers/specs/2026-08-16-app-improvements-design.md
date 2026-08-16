# Kinvt-study improvements — design

Date: 2026-08-16
Status: approved

Eight changes to the desktop app plus a content push to bring the six Exam Prep
topics to 150+ questions each. Cross-platform reach (macOS/Linux) is explicitly
out of scope.

## Motivation

The app already collects the data needed to teach better than it currently
does. Every answer is recorded, and missed questions are tracked for spaced
repetition, but selection is still uniform random across enabled topics and
none of the accumulated progress is ever shown back to the user. Separately,
the pipeline meant to grow the library has never run successfully, and the
Exam Prep topics — the ones the app exists for — hold 15–30 questions each,
which a user exhausts in a week.

## Scope

| # | Change | Why |
|---|---|---|
| 1 | Split `quiz-engine.js` into four modules | Prerequisite; the file already does too much |
| 2 | Adaptive difficulty and topic weighting | Use the data already collected |
| 3 | Per-topic progress dashboard | Progress is recorded but never surfaced |
| 4 | Generalized validator, source links in the card | Validator rejects 15 of 16 topics |
| 5 | Auto-update | Users currently redownload manually |
| 6 | Do-not-disturb awareness | Always-on-top over a game or a call |
| 7 | Backup and export of progress | Local-first data is lost on reinstall |
| 8 | CI | No automated build or check exists |
| 9 | Exam Prep topics to 150+ | 770 new questions |

## 1. Module split

`desktop/ui/quiz-engine.js` is 276 lines carrying settings, stats, remote sync,
spaced repetition, and quiz assembly. The features below add per-topic stats,
adaptive selection, and export, which would push it well past the size where it
can be held in context and edited reliably.

It splits into four units, each with one purpose and a stated dependency:

| File | Owns | Depends on |
|---|---|---|
| `ui/storage.js` | localStorage keys, defaults, safe read/write | nothing |
| `ui/progress.js` | stats (overall + per-topic), review queue, export/import | storage |
| `ui/selection.js` | topic weighting, difficulty banding, quiz assembly | progress |
| `ui/quiz-engine.js` | library load, remote sync, public `KinvtQuiz` API | all three |

`KinvtQuiz` remains the only public surface. `app.js`, `settings.js`, and
`ui-core.js` are not modified by this step, which is how the split is verified
as behaviour-preserving.

Each module keeps the existing IIFE-over-`global` pattern rather than switching
to ES modules, so the webview needs no build step and the files stay loadable by
the test harness.

This lands as its own commit, with tests, before any feature is built on it.

## 2. Adaptive difficulty

Two independent signals, both derived from data already recorded.

**Topic weighting.** `progress.js` maintains `byTopic[id] = {answered, correct}`.
Selection weights each enabled topic by `1 + (1 - accuracy)`, so a topic at 40%
accuracy receives roughly 1.6x the slots of one at 90%. A topic with fewer than
5 attempts is treated as accuracy 1.0 (neutral weight) so that a new topic is
not over-weighted on one unlucky answer.

**Difficulty banding.** A rolling window of the last 30 answers determines a
target band: above 75% biases toward `hard`, 50–75% toward `medium`, below 50%
toward `easy`. This is a bias applied during selection, not a filter — questions
outside the target band remain reachable, so the mix does not become monotonous
and a bank thin on one difficulty never starves.

**Composition order** per popup is unchanged in spirit: review questions first,
capped at 50% of the popup (existing `REVIEW_SHARE`), then adaptive fill for the
remainder.

Settings gains one toggle, `adaptive`, defaulting on. Off restores uniform
random selection.

### Data shape

```js
stats = {
  answered, correct, streak,          // existing, unchanged
  byTopic: { 'upsc': { answered, correct }, ... },
  recent: [1, 0, 1, ...]              // last 30 results, newest last
}
```

`recent` is capped at 30 entries on write. Existing stored stats lacking these
fields are merged against defaults by the existing `readJSON`, so no migration
step is needed.

## 3. Progress dashboard

A **Progress** section in `settings.html` showing:

- Overall accuracy, current streak, review-queue size, last sync time
- A per-topic table: attempted, accuracy, and a proportional bar

Rows sort **weakest first** among topics with attempts, so the actionable
information is at the top rather than alphabetically buried. Topics with no
attempts group at the bottom under "not started". Styling reuses existing
`settings.css` tokens; no new dependencies.

## 4. Validator, sources, and the expansion pipeline

### Validator

`scripts/validate-questions.mjs:70` hard-codes `q.category === 'current-affairs'`,
which rejects every question in the other 15 topics. This is the reason the
expansion workflow could never pass its own gate.

Changes:

- Category must match the topic id derived from the filename, not a constant.
- `source` becomes a **warning** by default and an **error** under
  `--require-source`. None of the 336 existing questions carry a source, so
  making it a hard error immediately would fail the entire library. New content
  is generated and validated with `--require-source`.
- New check: explanation is at least 40 characters.
- New check: explanation is not a bare restatement of the correct option.

### Expansion pipeline repair

`scripts/expand-library.mjs` cannot run at all:

- Line 22 reads `library.json` from the repo root; it exists only at
  `desktop/ui/library.json`, so the script throws before doing any work.
- It then reads and writes `topic.file` (`data/upsc.json`) relative to the root
  and *mirrors* into `desktop/ui/data/`. The real banks exist only at the mirror
  path, so it would generate against empty banks and leave a stray root `data/`.
- `.github/workflows/expand-library.yml` validates `data/*.json`, a path that
  does not exist.

All three are corrected to treat `desktop/ui/` as the single content root. The
mirror logic is removed rather than fixed — one location for the banks.

This repair is not needed for the Exam Prep content below, which is authored
directly. It is done so the remaining 10 topics can be topped up later without
re-deriving this analysis.

### Source links in the card

The webview CSP is `default-src 'self'`, so an anchor cannot open an external
page. A Rust command `open_url` hands the URL to the OS browser, allowlisted to
`http` and `https` schemes only — it must never be able to launch a local
executable path. The card renders a small "Source" link under the explanation
when the question carries one.

## 5. Auto-update

`tauri-plugin-updater` plus `tauri-plugin-process` (for restart-after-install),
with the update endpoint served from GitHub Releases as `latest.json`.

- `.github/workflows/release.yml` triggers on a version tag, builds on
  `windows-latest`, signs, and publishes the release with its signature.
- Settings displays the running version and a **Check for updates** button.
- A silent check runs once per launch, rate-limited to at most once per day,
  and never interrupts an open quiz card.

**The signing keypair is generated by the user**, via `cargo tauri signer
generate`. The private key and its password go into GitHub Actions secrets; the
public key is committed in `tauri.conf.json`. The implementation never handles
the private key.

If the public key is absent, the updater is inert and the rest of the app is
unaffected.

## 6. Do-not-disturb

A single Win32 call, `SHQueryUserNotificationState`, covers every case that
matters at once: fullscreen Direct3D (games), presentation mode, busy or
screen-sharing, and Focus Assist quiet time.

- **Scheduled** popups suppress unless the state accepts notifications.
- **Manual** triggers — Ctrl+Shift+Q and tray *Quiz me now* — always fire.
  They are explicit intent, and silently ignoring a hotkey reads as a bug.
- A suppressed popup is **skipped, not queued**. Queuing produces a burst of
  cards the moment a game closes, which is worse than missing one.

Adds a tray **Snooze 1 hour** item and a settings toggle (`respectDnd`,
default on). Non-Windows builds compile to a function returning "allowed", so
the feature is a no-op rather than a build break.

## 7. Backup and export

Exported payload:

```json
{ "version": 1, "exportedAt": "<iso>", "settings": {}, "stats": {}, "review": {} }
```

Import validates the shape and **merges** rather than clobbering: review entries
union (higher miss count wins), per-topic stats sum, settings are replaced.
Merging is the safer default — an import that silently discarded months of
review history would be unrecoverable, since this data exists nowhere else.

A malformed or wrong-version file is rejected with a message and changes
nothing.

`tauri-plugin-dialog` supplies the file picker. The file IO itself is a plain
`std::fs` Rust command, so this adds one plugin rather than two.

## 8. CI

`.github/workflows/ci.yml`, on push and pull request:

- Validate all 16 banks (without `--require-source`)
- Unit tests for `progress.js` and `selection.js` via `node --test`
- `cargo fmt --check`, `cargo clippy -D warnings`
- Release build on `windows-latest`

### Test harness

The UI modules are IIFEs that attach to a `global`, not ES modules, so they
cannot be `import`ed. A small helper reads each file and evaluates it against a
context carrying a `localStorage` stub, then asserts against the exported
object. This keeps the modules build-step-free while still making the pure
logic — weighting, banding, merge-on-import — directly testable.

Selection tests seed a fixed stats object and assert on the resulting
distribution rather than on exact picks, since selection is randomized.

## 9. Exam Prep topics to 150+

| Topic | Now | Target | New |
|---|---|---|---|
| UPSC | 30 | 150 | 120 |
| KPSC | 30 | 150 | 120 |
| SSC | 20 | 150 | 130 |
| Banking | 20 | 150 | 130 |
| Railways | 15 | 150 | 135 |
| Defence | 15 | 150 | 135 |
| | | | **770** |

Questions are authored directly rather than generated through the API pipeline,
so the work does not depend on an API key being available.

Every new question carries a `source` URL and is validated with
`--require-source` before commit. Batches are committed per topic so an
interrupted run keeps its progress, and so a bad batch can be reverted without
touching the others.

Order: UPSC, KPSC, SSC, Banking, Railways, Defence.

Constraints on the questions themselves, carried over from the existing
generation prompt because they are the right constraints:

- Exactly 4 options, exactly one unambiguously correct answer
- Distractors plausible but clearly wrong to someone who knows the fact
- No time-relative wording; it must read correctly years from now
- Roughly 40% easy, 40% medium, 20% hard
- Explanation states the fact and why the wrong answers are wrong

## Sequencing

Items 1–8 land before item 9. The content push is the long pole, and shipping
working software first means the app improves immediately rather than after
770 questions are written.

Within 1–8: the module split is first (everything depends on it), then adaptive
selection and the dashboard (which share `progress.js`), then the independent
shell-level work (sources, updater, DND, export), then CI last so it gates real
code rather than an empty repo.

## Risks

**Fact correctness cannot be validated.** No script can check that a question's
answer is true. The `source` URL exists so a human can. This is unchanged from
the existing pipeline and is stated in `docs/AUTOMATION.md`.

**Adaptive selection can feel like it is punishing a weak topic.** Weighting is
capped at 2x by construction, and the toggle exists for users who prefer a flat
mix.

**The updater is a remote code path in a local-first app.** It is signature-
verified, off unless a public key is present, and the app remains fully
functional offline.
