# Extension archive

The original Chrome/Firefox extension, kept for reference. It works — load
`src/` unpacked — but it is no longer the product.

It was retired because the popup needed to be transparent, frameless,
always-on-top and independent of the browser, and an extension cannot do all
four. Those are browser security boundaries, not missing features:

- An extension popup window cannot be transparent (an OS window has an opaque
  backing surface, with no page behind it to show through) and cannot drop its
  title bar — browsers enforce that so pages cannot impersonate native windows.
- An in-page overlay can be transparent and chromeless, but lives in one tab's
  DOM, so it dies when you switch tabs or minimise the browser.

The desktop app in `../desktop/` has none of those limits. It reuses this
code almost unchanged — `ui-core.js` (the card), the 16 question banks,
`library.json`, Poppins, and the settings UI all moved across — so this is
history rather than a parallel implementation.

`test-harness/` still runs: `node scripts/../test-harness/serve.js`.
