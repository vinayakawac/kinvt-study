# FAQ

**Does it use AI?**
The *app* does not — it never calls a model, and runs fully offline against static JSON.

Authoring is a different question. 15 of the 16 topics are hand-written. The **current-affairs** bank is drafted monthly by an automated pipeline that reads Wikipedia's Current Events portal and generates questions, gated by automated validation ([AUTOMATION.md](AUTOMATION.md)). Validation catches malformed questions and out-of-range answer keys, but it cannot verify that a fact is true — so every generated question carries a `source` URL. Treat current-affairs answers with more scepticism than the rest.

**Does it send my data anywhere?**
No. The only network request is a once-daily fetch of public question JSON from [kinvt-study](https://github.com/vinayakawac/kinvt-study). It is an unauthenticated `GET` of public files — nothing about you is included, and nothing is ever uploaded. Settings and stats stay in local storage on your machine.

**Where do settings and stats live?**
In the webview's local storage, inside the app's own data directory. There is no account and no server.

**Why does closing the quiz card not quit the app?**
It is a tray app. Closing the card dismisses that quiz; the app keeps running so the next one can appear on schedule. Quit properly from the tray menu.

**I closed the Settings window — is it still running?**
Yes. Look for the icon in the system tray. On Windows 11, new tray icons hide in the overflow flyout: click the `^` chevron near the clock and drag the icon out to pin it.

**Why is the quiz window transparent but the Settings window isn't?**
The quiz card is meant to float unobtrusively over your work, so it is transparent, frameless and always-on-top. Settings is an ordinary window because it is something you deliberately open and read.

**Can I change the hotkey from Ctrl+Shift+Q?**
Not from the UI yet. It is registered in `desktop/tauri/src/main.rs` (and `main.js` for Electron) — change it there and rebuild. If another app already owns the combination, registration fails and the app logs it but keeps working via the tray.

**Why are there two builds?**
Tauri is the real one: 3.3 MB, ~29 MB idle, one process. Electron exists only because Tauri needs a C++ toolchain that not every machine has; it produces a working .exe with nothing but Node. Both run the same `ui/` folder. See [DESKTOP_BUILD.md](DESKTOP_BUILD.md).

**How do I add my own questions?**
See [CONTENT.md](CONTENT.md). Either edit the bundled JSON and rebuild, or push to the content repo and every install picks it up within a day.
