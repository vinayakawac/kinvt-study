// Parses every JavaScript file that ships, before it can be packaged.
//
// A syntax error in the Electron main process is not a soft failure: the app
// shows "A JavaScript error occurred in the main process" and does nothing
// else. Nothing else here would catch it — the unit tests only load
// desktop/ui, and electron-builder packages whatever bytes it is given
// without ever parsing them.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not the working directory: this runs from the repo
// root in CI and from desktop/ as an npm prebuild hook.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(ROOT, 'desktop', 'ui');

const TARGETS = [
  path.join(ROOT, 'desktop', 'main.js'),
  path.join(ROOT, 'desktop', 'preload.js'),
  ...fs.readdirSync(UI).filter(f => f.endsWith('.js')).map(f => path.join(UI, f))
];

const errors = [];
for (const file of TARGETS) {
  try {
    // Compiles without executing, which is exactly the check wanted: these
    // modules touch document and window at load time and must not actually run.
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (e) {
    errors.push(`${path.relative(ROOT, file)}: ${e.message}`);
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} file(s) will not parse:`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ all ${TARGETS.length} shipped JavaScript files parse`);
