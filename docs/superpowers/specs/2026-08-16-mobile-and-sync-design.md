# Kinvt-study on Android, with device-to-device sync — design

Date: 2026-08-16
Status: approved

An Android app sharing the desktop app's UI and question banks, and progress
sync between the two that requires no account, no server, and no cloud service
of any kind.

iOS is deliberately out of scope for now. The stack chosen keeps it reachable
later without rework, which costs nothing today.

## Motivation

The question banks, the quiz card, the spaced-repetition logic and the settings
model already exist and already run in a webview. What is missing is a way to
study away from the desk, and a way for the two to agree on what you have
already answered.

Two constraints shape everything below:

- **No accounts and no hosted services**, not even a free tier. That removes
  every cloud sync option, including a GitHub Gist store.
- **Security must be tight** regardless.

Those two together point at direct device-to-device sync over the local
network, which is both cheaper and more private than a hosted backend.

## Scope

Three sub-projects, sequenced. Each is shippable on its own.

| | Sub-project | Depends on |
|---|---|---|
| A | Shared core and a correct merge | the module split in `2026-08-16-app-improvements-design.md` |
| B | Android shell and reminders | A |
| C | LAN pairing sync | A, B |

iOS would be a fourth, needing a Mac. Not planned here.

## Stack: Capacitor

Capacitor wraps the existing `desktop/ui/` folder unchanged — same vanilla
IIFE modules, same JSON banks, no build step and no rewrite — and exposes
native APIs for notifications, camera and storage. It is free and open source,
and produces either an APK or a Play Store bundle from the same project.

Rejected:

- **Tauri 2 mobile** would share Rust with the desktop shell, which is
  appealing, but the desktop's Rust is only window and tray plumbing, so there
  is little to share. Its mobile plugin ecosystem is thinner exactly where the
  risk is: notification scheduling, camera, background work.
- **React Native or Flutter** would mean rewriting a UI that already works,
  in a language the project does not otherwise use.
- **A pure PWA** cannot schedule reliable local notifications, which is the
  product's identity.

## Sub-project A — shared core and a correct merge

### The problem being fixed

`progress.js` currently merges an imported backup by **summing** counters. That
is acceptable for a one-off restore but it is **not idempotent**: importing the
same file twice doubles the answered count. Sync repeats constantly, so
summing cannot be the merge rule. This is already a latent bug in today's
backup and restore.

The fix is to make the state a CRDT, so that merging is idempotent,
commutative, and order-independent — three properties sync needs and summing
has none of.

### Device identity

Each install generates a `deviceId` once: a short random string with a prefix
for readability, e.g. `dsk-3f9a2c`, `and-7b1e44`. It is not an account, carries
no personal data, and never leaves the pair of devices being synced.

### Stats become per-device counters

```js
{
  schema: 2,
  deviceId: 'dsk-3f9a2c',
  byDevice: {
    'dsk-3f9a2c': { answered: 120, correct: 80 },
    'and-7b1e44': { answered: 40,  correct: 31 }
  },
  byTopic: {
    upsc: { byDevice: { 'dsk-3f9a2c': { answered: 30, correct: 22 } } }
  },
  recent: [1, 0, 1],              // local only, never synced
  streakByDevice: { 'dsk-3f9a2c': 3 }
}
```

Totals are computed, never stored: `answered` is the sum across `byDevice`.

**Merge rule.** For each device id, keep whichever record has the greater
`answered`, with greater `correct` as the tiebreak. The record is taken
*whole* rather than field-by-field: a device's two counters advance together,
so taking `max` of each independently could combine values from different
moments and report more correct answers than answered.

Because a device's own counters only ever increase, this converges and is
idempotent.

**`recent` is deliberately not synced.** It is the rolling window that picks the
difficulty band, and it describes how you are doing *on this device, right
now*. Merging it across devices would be meaningless.

**`streak` is per-device** for the same reason: a perfect-run streak is a
property of one continuous sitting.

### Review queue is last-write-wins, with tombstones

```js
review['up-007'] = {
  misses: 3,
  streak: 0,
  updatedAt: 1755300000000,
  updatedBy: 'and-7b1e44',
  retired: false
}
```

Merge takes the entry with the greater `updatedAt`, breaking ties by comparing
`updatedBy` so that both sides always pick the same winner.

**Retirement must be a tombstone, not a delete.** Today, retiring a question
removes its key. Under sync, a deleted key simply reappears from the other
device on the next exchange — the question would never stay retired. So
retirement sets `retired: true` with a timestamp, and `pickReviewQuestions`
skips retired entries. Tombstones older than 180 days are pruned, which is far
beyond any plausible sync gap.

### Settings split into synced and local

Not all settings should travel:

| Synced | Local to each device |
|---|---|
| `topics`, `adaptive`, `perQuiz` | `intervalMin`, `theme`, `glass`, `glassCustom`, `respectDnd` |

Which topics you are studying is a property of *you*; how often a device
interrupts you and what it looks like are properties of *that device*. A phone
reminding you every 30 minutes is not the same request as a desktop doing it.

Synced settings use whole-object last-write-wins on a `settings.updatedAt`
stamp. Conflicts here are rare and low-stakes.

### Migration

A v1 stats object (flat `answered`/`correct`) is migrated on first read: its
counters move into `byDevice[thisDevice]` and `schema` is set to 2. Review
entries gain `updatedAt` set to `lastMissedAt` or the migration time, and
`retired: false`. This runs once and needs no user action.

### Where the code lives

The merge is pure data manipulation with no I/O, so it lives in the shared
`desktop/ui/` tree and is unit-tested with the existing `node --test` harness:

- `ui/progress.js` — extended with the CRDT shapes and migration
- `ui/merge.js` — new: `mergeStats`, `mergeReview`, `mergeSettings`, pure
  functions taking two states and returning a third

Being pure functions, the merge is testable without any device, network or
shell — including the properties that matter: merging twice equals merging
once, and merge order does not change the result.

## Sub-project B — the Android shell

### Structure

```
mobile/
  capacitor.config.json      app id, name, and the path to the shared UI
  android/                   generated Android project, committed
  www/                       build output: a copy of desktop/ui + mobile shims
```

`www/` is generated, never edited by hand. A script copies `desktop/ui/` into
it, exactly as `sync-feed.mjs` already generates the root question feed from
the same source. `desktop/ui/` remains the single source of truth for UI and
content.

### Storage

The webview's `localStorage` is not durable enough on Android — the system can
clear webview data under storage pressure, and losing months of review history
that exists nowhere else is unacceptable. The mobile build therefore backs
`KinvtStorage` with `@capacitor/preferences`.

This is exactly what the `storage.js` split from the app-improvements design
buys: one module to swap, and `progress.js`, `selection.js` and the UI are
untouched. `KinvtStorage`'s interface gains async variants for the mobile
backend; the desktop keeps its synchronous localStorage implementation.

### Reminders

The always-on-top card has no Android equivalent and should not be simulated.
The native idiom is a **notification** that opens the quiz when tapped, via
`@capacitor/local-notifications`.

Realities that shape this, rather than being discovered later:

- Android 13+ requires runtime `POST_NOTIFICATIONS` permission. The app asks
  on first run and degrades to open-and-practise if refused.
- Doze batches alarms, so reminders arrive **near** their time, not to the
  second. For study prompts this is correct behaviour and much kinder to the
  battery than exact alarms.
- Several OEM Android skins kill background work aggressively. This is a
  documented limitation, not something the app can fully solve.

The desktop's do-not-disturb concept maps onto a quiet-hours setting: no
reminders between a configured start and end time.

### Packaging

Debug and release APKs are built with Gradle and signed with a self-generated
keystore. The keystore and its passwords never enter the repository; the
release workflow reads them from GitHub Actions secrets, exactly as the desktop
updater's signing key does.

APKs attach to GitHub releases alongside the desktop builds. A Play Store
listing later is a signing-config change and a store account, with no code
change.

## Sub-project C — LAN pairing sync

### Protocol

1. On the desktop the user chooses **Pair a device**. It generates a random
   256-bit key, starts an HTTP listener on an ephemeral port bound to the LAN
   interface, and displays a QR code.
2. The QR encodes `kinvt1://<host>:<port>/?k=<key>&d=<deviceId>&e=<expiry>`.
   The phone's camera reads it.
3. The phone POSTs its state to `/v1/sync`, encrypted with that key.
4. The desktop decrypts, verifies, merges, and returns its own encrypted state.
5. The phone decrypts and merges. Both store the peer's id and key so later
   syncs need no QR.
6. The listener stops on success, or after two minutes.

The desktop is always the listener and the phone always the client, because the
phone is the device with a camera and the desktop is the device that can
comfortably display a code.

### Why this is secure without a server

**The key is exchanged optically and never crosses the network.** The QR code is
an out-of-band channel, which is what makes plain HTTP acceptable as transport:
the payload itself is end-to-end encrypted.

- **AES-256-GCM** provides confidentiality and integrity together. An attacker
  on the same Wi-Fi sees only ciphertext, and cannot forge or tamper with a
  message — GCM's authentication tag fails closed on a wrong key.
- **Replay is rejected** by a random 12-byte nonce per message plus a timestamp;
  messages outside a five-minute window, or reusing a seen nonce, are refused.
- **Exposure is bounded**: the listener exists only during a sync, answers only
  `/v1/sync`, and the pairing QR expires after two minutes so a bystander's
  photograph is worthless shortly after.

`crypto.subtle` is present in both webviews, so the encryption and the merge are
**shared code running identically on both sides** rather than two
implementations that must be kept in agreement.

### Honest limitations

- **Paired keys are stored at rest** in each device's app storage. They are
  therefore exactly as protected as that device is. A **Forget device** control
  removes a pairing, and pairing again is a QR scan away.
- **Both devices must be on the same network.** When they are not, the existing
  encrypted file export and import remains the fallback, and is the reason that
  feature stays rather than being replaced.
- **Windows will prompt on first listen**, since a process is opening a port.

### Future scope this leaves open

The merge is a pure function over state, and the transport is a separate,
small surface. A cloud provider — should the no-account constraint ever be
relaxed — would be a new transport implementation with the merge untouched.
Nothing in this design forecloses it, and nothing requires it.

## Cost

| | |
|---|---|
| Capacitor, Android SDK, Gradle | free |
| APK signing with a self-made keystore | free |
| Distribution via GitHub Releases | free |
| Sync infrastructure | none exists |
| **Recurring** | **zero** |

Google Play, if ever wanted, is a one-time $25 registration. Apple's $99/year
applies only if iOS is revived.

## Risks

**Background reminders are not fully within the app's control.** Doze and OEM
battery managers can delay or suppress them. Mitigated by using inexact alarms
by design, asking for notification permission clearly, and documenting the
OEM behaviour rather than pretending it does not exist.

**The CRDT migration touches the only copy of the user's history.** Mitigated by
migrating on read without destroying the v1 keys until a v2 write succeeds, and
by unit-testing the migration against realistic v1 fixtures.

**Sync correctness is hard to eyeball.** Mitigated by making the merge pure and
testing the CRDT properties directly: idempotence, commutativity, and
convergence from divergent replicas.
