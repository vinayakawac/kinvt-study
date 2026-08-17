# Handoff — Desktop

Paste this into a new session working on the desktop app or the question banks.

---

I'm continuing work on **Kinvt-study**, an offline MCQ quiz app for Indian
competitive-exam prep. Repo: `X:\.projectz\kinvtstudy`, GitHub
`vinayakawac/kinvt-study`, branch `main`. Everything below is committed and
pushed. **This session is desktop + content only** — a separate session owns
Android.

## Shape of the thing

A tray app that floats a translucent MCQ card over your work on a schedule.
Two shells over one shared UI:

| | Tauri | Electron |
|---|---|---|
| Size | 3.3 MB / 29 MB idle | 82 MB / 92 MB, 4 processes |
| Builds locally? | **No** — needs MSVC, not installed | **Yes** |
| Where it builds | CI (`windows-latest`) | `cd desktop && npm run build` |

`desktop/ui/` is the shared UI and the single source of truth. It is plain
IIFE-over-`global` modules with **no build step** — never introduce
`import`/`export` there.

```
desktop/ui/
  storage.js      persistence + pluggable backend + device id
  merge.js        CRDT merge (pure, no I/O)
  progress.js     stats, spaced repetition, backup payloads
  selection.js    adaptive topic weighting + difficulty banding
  quiz-engine.js  settings, library, buildQuiz — the only public surface
  quiet-hours.js  shared with Android
  sync-crypto.js  AES-256-GCM envelope
  sync-pairing.js QR pairing URLs + peer store
  sync-session.js the exchange, transport-free
  qr.js           from-scratch QR encoder (CSP forbids a CDN)
  ui-core.js      the quiz card (TPQ_UI)
  app.js          quiz window controller
  settings.js     settings window
```

Rust owns only window/tray/hotkey plumbing and the sync socket — deliberately
no crypto, so there is one protocol implementation shared with the phone.

## Content

**876 questions across 18 topics.** Exam Prep progress:

| Topic | | |
|---|---|---|
| UPSC, KPSC, VAO, Land Surveyor | 150 each | done |
| SSC, Banking | 20 each | needs 130 each |
| Railways, Defence | 15 each | needs 135 each |

**530 questions remain.** All four are generic (not Karnataka-specific), so
the API pipeline can handle them.

Adding questions:

```bash
# write a JSON array to a temp file, then:
node scripts/append-questions.mjs <topic-id> <batch.json>
node scripts/validate-questions.mjs desktop/ui/data/<topic>.json --require-source
node scripts/sync-feed.mjs      # regenerate the root data/ feed
```

Every question needs 4 distinct options, an in-range answer, a ≥40-char
explanation saying why the wrong options are wrong, a real Wikipedia `source`,
and **no time-relative wording** (the validator warns on "currently",
"current chairman" etc. unless the question carries a year).

**Always diff a batch against what landed.** A cleanup regex once silently
turned `"S 30° W"` into `"S 302 W"` in six existing questions, and nothing else
would have caught it.

## The bit most likely to trip you up

`data/` at the repo root is **not** a duplicate of `desktop/ui/data/` — it is
the **sync feed**. Every installed copy fetches
`raw.githubusercontent.com/.../main/data/*.json` daily and merges by question
id, which is how content improves without shipping a new binary. Edit only
`desktop/ui/` and run `node scripts/sync-feed.mjs`; CI fails on drift.

## Progress is a CRDT

Counters are per device and merge by taking the more advanced record, so
importing a backup twice is a no-op. The old code summed and doubled your
totals. Review entries are last-write-wins, and **retirement is a tombstone** —
deleting the key makes the question resurrect from the peer on the next sync.

Two bugs worth remembering, both caught before shipping:

- `getStats()` read with `DEFAULT_STATS` as its fallback, and `read()` merges
  stored data *over* the fallback — so `schema: 2` got stamped onto v1 data and
  every existing user's history would have reset to zero.
- A regex written through a shell heredoc came out mangled and crashed the
  Electron app on launch. **Never use scripted regex/`sed` surgery on source
  files** — it broke things four times in one session. Use the Edit tool.

## Before committing

```bash
node scripts/check-syntax.mjs         # parses every shipped .js
node scripts/check-library.mjs        # topics wired in all 4 places
node scripts/check-ui-scripts.mjs     # module load order in every page
node scripts/check-shell-parity.mjs   # Tauri and Electron expose the same commands
node scripts/sync-feed.mjs --check
node --test scripts/test/*.test.mjs   # 104 tests
cd desktop/tauri && cargo fmt --check
```

Rebuilding the Electron exe (kill any running instance first, it locks `dist/`):

```bash
cd desktop && npm run build     # prebuild runs syntax + parity gates
```

Output in `desktop/dist/`; I also collect builds into `builds/` (gitignored).

## Known state

- v1.0.0 is released on GitHub with the Electron builds attached
- CI is green: banks, syntax, wiring, parity, tests, Tauri build, Android build
- A local scheduled task `kinvt-question-topup` runs monthly (1st, 9am) and
  adds ≤60 questions, committing locally without pushing
- Desktop sync **listener** exists in both shells but has never completed a
  real device-to-device sync — the protocol passes 22 unit tests and a
  real-socket test only

## Reasonable next steps

- Finish SSC, Banking, Railways, Defence to 150 (530 questions)
- Verify a real desktop↔phone sync end to end
- The Tauri build is the better product (3.3 MB, one process) but needs MSVC
  Build Tools installed to build locally
