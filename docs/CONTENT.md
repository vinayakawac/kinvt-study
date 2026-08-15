# The question library

336 questions across 16 topics, all plain JSON. No AI, no generation — every
question was written by hand and ships with the app.

## Layout

```
desktop/ui/library.json     the 16-topic registry (id, label, icon, group, blurb, file)
desktop/ui/data/*.json      one file per topic
```

`library.json` is the single source of truth for what topics exist. The
settings window renders its checkboxes from it, and the quiz builder reads it
to decide which banks to load — so adding a topic needs no code change.

## Schema

```json
{
  "name": "UPSC / Civil Services",
  "description": "Prelims-style questions…",
  "questions": [
    {
      "id": "up-001",
      "category": "upsc",
      "topic": "Polity",
      "difficulty": "medium",
      "question": "…",
      "options": ["…", "…", "…", "…"],
      "answer": 1,
      "explanation": "Shown only when you get it wrong."
    }
  ]
}
```

- `answer` is the **0-based index** into `options`.
- `id` must be stable and unique within its file — see the sync rules below.
- `explanation` is optional but worth writing: it is the whole point of
  getting one wrong.

## Adding a topic

1. Create `desktop/ui/data/your-topic.json` using the schema above.
2. Add one entry to `desktop/ui/library.json`:
   ```json
   { "id": "your-topic", "label": "Your Topic", "icon": "globe",
     "group": "Subjects", "blurb": "short description", "file": "data/your-topic.json" }
   ```
   `icon` must be one of the keys in `settings.js`'s `ICONS` map; `group` is
   `"Exam Prep"` or `"Subjects"` (a new group name just creates a new
   collapsible section).
3. Rebuild. The topic appears in Settings with a checkbox automatically.

## Daily sync

Bundled questions only change when the app is reinstalled, so the app also
pulls from the public [kinvt-study](https://github.com/vinayakawac/kinvt-study)
repo once a day (and once at startup). This decouples content freshness from
app releases: push a question, every install has it within a day.

- Fetched from `raw.githubusercontent.com/vinayakawac/kinvt-study/main/data/…`
- Merged into the bundled bank **by question `id`** — the same id updates that
  question everywhere, a new id adds one. Nothing is ever deleted locally.
- A failed fetch (offline, repo unreachable) leaves the bundled copy untouched.
  The library can never end up empty because of a sync.

To publish a change, edit the file under the repo's **root-level** `data/`
folder and push. That path is load-bearing: `quiz-engine.js`'s `REMOTE_BASE`
fetches from exactly there, so keep `data/` and `library.json` at the repo
root even as the rest of the tree changes.

Sync is subject to the app's CSP. If you point it at a different host, add
that host to `connect-src` in `desktop/tauri/tauri.conf.json` — otherwise the
fetch is blocked silently.
