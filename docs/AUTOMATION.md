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
