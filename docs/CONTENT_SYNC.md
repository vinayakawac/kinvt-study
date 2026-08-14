# Content Sync

How the question library updates itself without any user interaction, and how to publish new questions.

## Why this exists

Questions ship bundled inside the extension (`src/data/*.json`) so it's fully functional offline from the moment it's installed. But bundled content only updates when a user reinstalls or updates the extension package. The daily sync decouples *content* freshness from *extension version* — you can add or correct questions at any time without republishing the extension itself.

## How it works

1. `background.js` registers a second alarm (`tpq-content-sync`) alongside the quiz-popup alarm, firing once every 24 hours (`SYNC_PERIOD_MINUTES = 24 * 60`), plus once immediately on install.
2. On fire, `syncContent()`:
   - Fetches `library.json` from the extension bundle (the topic registry doesn't itself sync — only question content does).
   - For each topic, fetches `https://raw.githubusercontent.com/vinayakawac/kinvt-study/main/data/<file>.json` with `cache: 'no-store'` and a cache-busting query param.
   - On success, stores the fetched questions in `chrome.storage.local.remoteLibrary[topicId] = { questions, updatedAt }`.
   - On failure for any single topic (offline, 404, malformed JSON), that topic is simply skipped — it keeps using the bundled version until a future sync succeeds.
3. Every time `buildQuiz()` runs, it merges `remoteLibrary[topicId].questions` on top of the bundled `data/<file>.json` questions **by `id`** — a synced question with the same `id` as a bundled one replaces it; a new `id` adds a new question. Nothing is ever deleted locally by a sync.

## No permission prompt needed

The extension already requires `<all_urls>` in `host_permissions` (declared, not optional) for overlay injection into arbitrary pages. Since `raw.githubusercontent.com` falls under `<all_urls>`, no additional runtime permission request is needed for the sync fetch — it "just works" from the moment the extension is installed, with zero user interaction.

## Publishing new or updated questions

The [kinvt-study](https://github.com/vinayakawac/kinvt-study) repo holds two copies of the same content:

- `src/data/*.json` + `src/library.json` — the extension's own source tree, used when building/packaging the extension itself.
- `data/*.json` + `library.json` at the **repo root** — what installed extensions actually fetch during the daily sync. `background.js`'s `REMOTE_LIBRARY_BASE` points at exactly these root-level paths.

**To publish a change**: edit the file(s) under root-level `data/` (and mirror the same edit under `src/data/` if you also want it in the next extension build), commit, and push. Every installed copy of the extension picks it up within 24 hours — no extension update, no user action.

### Question schema

```json
{
  "name": "Topic name",
  "description": "…",
  "questions": [
    {
      "id": "upsc-031",
      "category": "upsc",
      "topic": "Polity",
      "difficulty": "medium",
      "question": "…",
      "options": ["…", "…", "…", "…"],
      "answer": 0,
      "explanation": "short one-line context, optional"
    }
  ]
}
```

- `answer` is the 0-based index of the correct option.
- `id` must be stable and unique within its file — reusing an existing `id` **updates** that question for every installed copy; a new `id` **adds** a new question.
- `category` should match the topic's `id` in `library.json`.

### Adding an entirely new topic

1. Create `data/your-topic.json` (root) and `src/data/your-topic.json` (source tree) with the schema above.
2. Add one entry to both `library.json` files: `{ "id", "label", "icon", "group", "blurb", "file" }`. `icon` must be one of the keys in `sidepanel.js`'s `ICONS` map (or add a new one there).
3. Push. New installs and the next sync cycle on existing installs will pick up the topic — it appears as a new checkbox in the Library section automatically.

## Checking sync status

- **In the sidepanel UI**: the Library section shows "Library last synced X ago."
- **From the service worker console** (`chrome://extensions` → the extension → "service worker"):
  ```js
  chrome.storage.local.get(['lastSyncAt', 'remoteLibrary']).then(console.log)
  ```
- **Forcing a sync during development**: `syncContent()` is a top-level function in `background.js`, so it's callable directly from the service worker console.

## Verifying the merge logic without waiting on a real sync cycle

See `test-harness/background-test.html` — it intercepts `fetch()` calls aimed at `raw.githubusercontent.com`, injects a test question, and runs the real `syncContent()` + `buildQuiz()` functions unmodified, then reports whether the merge worked. Useful for confirming changes to the sync/merge logic without needing to wait a day or rely on GitHub's CDN having propagated a real push yet (raw.githubusercontent.com typically takes a few minutes to reflect a fresh commit).
