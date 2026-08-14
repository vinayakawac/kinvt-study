// Safety-net placeholder. This extension's own code sticks to promise-based
// calls and the browser-api.js shim (browser ?? chrome), so Firefox's native
// `browser` namespace is normally sufficient without the full polyfill.
// If testing on Firefox surfaces an API gap, replace this file with Mozilla's
// official webextension-polyfill build:
// https://github.com/mozilla/webextension-polyfill
