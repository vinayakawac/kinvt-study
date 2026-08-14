# Permissions — honest list

Every permission `manifest.json` requests, and exactly why.

| Permission | Why |
|---|---|
| `storage` | Save settings, quiz stats, and the synced question library locally (`chrome.storage.local`), plus the short-lived quiz payload handoff between the service worker and the injected UI (`chrome.storage.session`). |
| `alarms` | Wake the service worker on a schedule — the low-CPU alternative to a persistent `setInterval`. Used for both the quiz-popup timer and the once-daily content sync. |
| `scripting` | Inject the quiz card (`ui-core.js` + `overlay.js`) into the tab you're viewing when a popup fires. |
| `sidePanel` | The Chrome/Edge side panel that hosts the settings sidecar. (Firefox uses `sidebar_action` instead, declared separately — no extra permission needed there.) |
| `host_permissions: <all_urls>` | Required for `scripting` to inject into arbitrary pages. The extension **never reads page content** — injection is one-way (render UI only); the overlay's shadow DOM doesn't touch the host page's DOM or scripts, and none of the extension's code queries `document` on the page being injected into beyond building its own isolated card. |

## What this also enables, without asking for anything extra

Because `<all_urls>` is already a required permission, the once-daily background content sync (fetching from `raw.githubusercontent.com`) needs **no additional runtime permission request** — it's already covered. See [CONTENT_SYNC.md](CONTENT_SYNC.md) for what that sync does and doesn't do (it only ever reads question JSON from one specific public repo; it never sends any data anywhere).

## What's explicitly *not* requested

- `tabs` — not needed; `chrome.tabs.query({active:true, lastFocusedWindow:true})` works without it for getting a tab id to inject into.
- `identity`, `cookies`, `history`, `bookmarks`, or any other data-access permission — none of this extension's functionality touches any of that.
- Any AI/LLM API permission or third-party analytics SDK — there is none in this codebase.

## Data that leaves your machine

Only the once-daily fetch of public, static JSON files from `raw.githubusercontent.com/vinayakawac/kinvt-study`. No request ever includes any user data — it's a plain unauthenticated `GET` of public content. Nothing is ever sent *to* that repo or anywhere else; the extension only reads from it.
