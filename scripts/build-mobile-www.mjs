// Generates mobile/www from desktop/ui.
//
// The app's UI now exists in three places — the desktop bundle, the root data/
// sync feed, and the Android package — and only one of them is written by
// hand. Copying rather than symlinking is deliberate: Gradle packages what is
// on disk, and a symlink would either break the build or silently ship
// nothing.
//
// usage: node scripts/build-mobile-www.mjs [--check]
//        --check verifies mobile/www matches desktop/ui without writing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(ROOT, 'desktop', 'ui');
const WWW = path.join(ROOT, 'mobile', 'www');
const SHIM_SRC = path.join(ROOT, 'mobile', 'src', 'shim');

const check = process.argv.includes('--check');

// The preview harness has no place in an APK.
const SKIP = /^_preview/;

function walk(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(path.join(dir, base))) {
    if (SKIP.test(name)) continue;
    const rel = path.join(base, name);
    if (fs.statSync(path.join(dir, rel)).isDirectory()) out.push(...walk(dir, rel));
    else out.push(rel);
  }
  return out;
}

const stale = [];

function place(relTo, body) {
  const to = path.join(WWW, relTo);
  const current = fs.existsSync(to) ? fs.readFileSync(to) : null;
  if (current && current.equals(body)) return;
  stale.push(relTo);
  if (!check) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, body);
  }
}

// The shims are injected into the copy rather than referenced from
// desktop/ui, so the desktop pages stay free of scripts that would 404 there.
// The phone's home screen is the settings page, not the quiz window.
//
// index.html is the DESKTOP quiz window: a transparent, chromeless page whose
// body is an empty #card that only fills when a popup fires. Shipping it as the
// Android launch page gave exactly what you would expect — a blank screen.
// The settings page already has the topic list, progress and controls, so it is
// the right home, and the quiz renders over it as a full-screen overlay.
function buildMobileIndex(settingsHtml) {
  return injectShims(
    settingsHtml
      .replace('<title>Kinvt-study — Settings</title>', '<title>Kinvt-study</title>')
      // ui-core.js draws the quiz card and is not loaded by the settings page.
      .replace('  <script src="qr.js"></script>', '  <script src="ui-core.js"></script>\n  <script src="qr.js"></script>')
  );
}

function injectShims(html) {
  return html
    // Without this an Android webview assumes a ~980px page and scales the
    // whole thing down, so a 375px phone renders the app at about a third
    // size. The desktop shells size their own windows and never needed it.
    .replace('  <meta charset="utf-8">',
      '  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
    .replace('  <script src="ui-core.js"></script>',
      '  <link rel="stylesheet" href="shim/mobile.css">\n  <script src="ui-core.js"></script>')
    // storage-native.js swaps KinvtStorage's backend, so it must run AFTER
    // storage.js defines it and BEFORE progress.js does its first read.
    // Placed anywhere earlier it finds no KinvtStorage, silently does nothing,
    // and Android quietly falls back to the localStorage this exists to avoid.
    .replace('  <script src="progress.js"></script>',
      '  <script src="shim/storage-native.js"></script>\n  <script src="progress.js"></script>')
    // These depend on KinvtQuiz and TPQ_UI. On the settings page they go after
    // settings.js; app.js is the desktop window controller and is dropped.
    .replace('  <script src="app.js"></script>', SHIM_TAIL)
    .replace('  <script src="settings.js"></script>', '  <script src="settings.js"></script>\n' + SHIM_TAIL);
}

const SHIM_TAIL = [
  '  <script src="shim/reminders.js"></script>',
  '  <script src="shim/scan.js"></script>',
  '  <script src="shim/mobile-nav.js"></script>',
  '  <script src="shim/mobile-app.js"></script>'
].join('\n');

const uiFiles = walk(UI);
const settingsHtml = fs.readFileSync(path.join(UI, 'settings.html'), 'utf8');

for (const rel of uiFiles) {
  const src = fs.readFileSync(path.join(UI, rel));
  if (rel === 'index.html') {
    // Replaced wholesale: the desktop quiz window is not a phone home screen.
    place(rel, Buffer.from(buildMobileIndex(settingsHtml)));
  } else if (rel === 'settings.html') {
    // Kept for completeness, though the app opens index.html.
    place(rel, Buffer.from(injectShims(src.toString('utf8'))));
  } else {
    place(rel, src);
  }
}

// The shim supplies what Tauri provides on the desktop: durable storage,
// notifications, the camera. It lives outside desktop/ui because it is
// meaningless there, and is copied in alongside.
const shimFiles = fs.existsSync(SHIM_SRC) ? fs.readdirSync(SHIM_SRC) : [];
for (const name of shimFiles) {
  place(path.join('shim', name), fs.readFileSync(path.join(SHIM_SRC, name)));
}

// A file deleted from desktop/ui must not linger in the APK.
const expected = new Set([...uiFiles, ...shimFiles.map(n => path.join('shim', n))]);
if (fs.existsSync(WWW)) {
  for (const rel of walk(WWW)) {
    if (expected.has(rel)) continue;
    stale.push(rel + ' (removed)');
    if (!check) fs.unlinkSync(path.join(WWW, rel));
  }
}

if (check) {
  if (stale.length) {
    console.error(`\n✗ mobile/www is stale — ${stale.length} file(s) differ from desktop/ui:`);
    stale.forEach(f => console.error('  - ' + f));
    console.error('\nRun: node scripts/build-mobile-www.mjs');
    process.exit(1);
  }
  console.log(`✓ mobile/www matches desktop/ui (${expected.size} files)`);
} else {
  console.log(stale.length
    ? `✓ updated ${stale.length} file(s) in mobile/www`
    : `✓ mobile/www already current (${expected.size} files)`);
}
