# Translucent Pop — Smart Quiz

A translucent, near-zero-CPU MCQ quiz browser extension for competitive-exam prep. While you browse, a frosted-glass card periodically slides up over the page and asks you 1–5 questions — General Knowledge, UPSC, KPSC/KAS, SSC, Banking, and more, across 336 bundled questions in 16 topics. Local-first and no AI: questions are static JSON, bundled offline and also kept fresh via a small daily background sync, with no clicks required.

## Setup

```bash
npm run build
```

Then load it unpacked:

- **Chrome / Edge / Brave**: `chrome://extensions` → enable Developer Mode → "Load unpacked" → select `build/` (or `src/` directly for faster iteration).
- **Firefox**: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select `manifest.json` inside `build/` or `src/`.

## Documentation

See [docs/](docs/) for architecture, the content-sync mechanics, permissions, error handling, troubleshooting, and FAQ.

## License

MIT — see [LICENSE](LICENSE).
