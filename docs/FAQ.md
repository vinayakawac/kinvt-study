# FAQ

**Does this use AI to generate questions?**
No. Every question is static, hand-written JSON. Nothing is ever generated at runtime, and no LLM/AI API is called anywhere in this codebase.

**Does it send my browsing data anywhere?**
No. The only network request the extension ever makes is a once-daily, unauthenticated `GET` of public JSON files from [kinvt-study](https://github.com/vinayakawac/kinvt-study) on GitHub — see [PERMISSIONS.md](PERMISSIONS.md#data-that-leaves-your-machine). It never reads page content, never sends analytics, and has no account system.

**Why does it need permission to access all sites?**
So it can show the translucent quiz card as an overlay on whatever page you're browsing when a popup fires. It's injection-only — the extension never reads anything from the page. See [PERMISSIONS.md](PERMISSIONS.md).

**Will my quiz stats sync across devices?**
No — stats live in `chrome.storage.local`, which is per-browser-profile, not synced across devices. This is intentional (no accounts, no server to sync through).

**How do I add my own questions?**
See [CONTENT_SYNC.md](CONTENT_SYNC.md#publishing-new-or-updated-questions). Either edit `src/data/*.json` and rebuild the extension yourself, or (if you have push access to the content repo) edit the root-level `data/*.json` on GitHub — every installed copy picks it up within a day, no rebuild needed.

**How fast does a content change propagate to installed extensions?**
Up to 24 hours (the sync interval), plus GitHub's raw-content CDN typically takes a few minutes to reflect a fresh push. There's no way to push an instant update — this is intentional, to keep the sync a lightweight once-a-day fetch rather than something that needs to poll.

**Can I run this without the background sync at all?**
Not currently exposed as a setting — the bundled JSON always works offline regardless (the sync only adds/updates on top), so in practice there's no functional difference if you never touch the content repo or if the fetch always fails.

**Why doesn't the popup interval go below 15 minutes / above 2 hours?**
That's a UI choice in `sidepanel.html`'s `<select>` options, not a hard technical limit — `chrome.alarms` supports any interval down to 1 minute. Edit `sidepanel.html`'s interval `<option>`s and `background.js`'s `ensureAlarm()` clamp if you want a different range.

**Does the quiz card work over `chrome://` pages or the Chrome Web Store?**
No — those pages block content-script injection by design (browser policy, not something this extension can override). It falls back to a small popup window (`quiz-window.html`) on those pages instead.

**I found a bug — where do I start debugging?**
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) first, then [ERROR_HANDLING.md](ERROR_HANDLING.md) for the failure-handling patterns used throughout (including two real bugs found and fixed during development, documented there in detail as examples of the kind of thing to watch for).
