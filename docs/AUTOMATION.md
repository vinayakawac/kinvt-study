# Automated current-affairs refresh

Current-affairs questions go stale; the other 15 topics do not. A scheduled
GitHub Action drafts new ones monthly so the bank stays exam-relevant without
anyone hand-writing them.

## One-time setup

Add an Anthropic API key to the repo:

**Settings → Secrets and variables → Actions → New repository secret**
- Name: `ANTHROPIC_API_KEY`
- Value: your key from <https://console.anthropic.com>

Until that exists the workflow fails immediately and changes nothing.

Cost is a few cents per run (one request, ~15 questions).

## What runs

`.github/workflows/refresh-current-affairs.yml`, at 02:00 UTC on the 1st of
each month, or on demand from the Actions tab.

1. **Gather** — pulls this month's and last month's Wikipedia Current Events
   portal. Wikipedia rather than a news API because entries are dated,
   pre-summarised, and cited, which is what makes a generated question
   checkable afterwards. If nothing is fetched the run aborts rather than
   letting the model invent questions from memory.
2. **Draft** — Claude writes questions from *that text only*, told explicitly
   not to use outside knowledge, to avoid time-relative wording
   ("recently"), and not to repeat existing questions.
3. **Validate** — `scripts/validate-questions.mjs`.
4. **Prune** — drops questions older than 12 months, never emptying the bank.
5. **PR, then auto-merge** if validation passed.

Merging updates `data/`, which every installed app syncs within 24 hours.

## What validation does and does not cover

Enforced, and a failure blocks the merge:

- valid JSON, `questions` is an array
- unique ids, no duplicated question wording
- exactly 4 distinct non-blank options
- `answer` is an integer index that is actually in range
- `category` is `current-affairs`
- every question carries a `source` URL

**It cannot check whether a fact is true.** No script can. That is the residual
risk of automating this, and it is why every question carries a source URL and
why the PR body says to spot-check. A wrong answer key is worse than a stale
question — you memorise it.

If you would rather review before shipping, delete the `Auto-merge` step; the
PR then waits for you.

## Turning it off

Delete the workflow file, or disable it in the Actions tab. The app keeps
working — bundled questions ship with it and the sync simply finds nothing new.


## Expanding the library to 150+ per topic

`scripts/expand-library.mjs` tops every topic up to a target count. The
library ships with 336 questions across 16 topics; 150 each means ~2,400, so
this generates roughly 2,000 questions.

Run it from **Actions → Expand question library → Run workflow**:

- `target` — questions per topic (default 150)
- `only_topic` — a single topic id, or blank for all
- `max_calls` — hard ceiling on API calls, purely a cost guard (default 60)

It is **manual only**. Filling every topic is many API calls, so it must never
fire on a schedule by accident.

### Run it in stages

`max_calls` stops the run when the ceiling is hit, and progress is written to
disk after **every batch** — so an interrupted run keeps everything it made.
Re-running continues from wherever each topic got to, because the script reads
the current counts each time.

Doing one topic at a time (`only_topic`) is the sane way to start: check that
topic's output quality before spending calls on the other fifteen.

### The accuracy caveat, stated once more

Static topics are generated from the model's subject knowledge, not from
fetched source text. Validation catches malformed questions and out-of-range
answer keys; it cannot tell you whether a fact is right.

At this volume you cannot check every question, so check a *sample* — a dozen
spread across topics, against their `source` URLs. If the sample is clean the
batch is probably fine; if you find two wrong, reject the batch. A wrong answer
key is worse than a missing question, because you will memorise it.
