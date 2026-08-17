// The UI is shared by two shells, so a command must exist in both.
//
// This failure mode is silent and has already happened: Electron's preload
// rejects any command not on its allowlist, and Tauri ignores any command not
// in generate_handler!. Either way the page's invoke() settles quietly and the
// feature simply does nothing, with no error anyone would notice.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not the working directory: this runs from the repo
// root in CI and from desktop/ as an npm prebuild hook.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Every UI module, not a hand-kept list: ui-core.js started calling invoke()
// for source links and a fixed list would simply not have noticed.
const UI_DIR = path.join(ROOT, 'desktop', 'ui');
const ui = fs.readdirSync(UI_DIR)
  .filter(f => f.endsWith('.js') && !f.startsWith('_'))
  .map(f => read('desktop', 'ui', f))
  .join('\n');

// Every invoke('name') the UI actually makes.
const wanted = [...new Set([...ui.matchAll(/invoke\(\s*['"]([a-z_]+)['"]/g)].map(m => m[1]))].sort();

const handlers = (read('desktop', 'tauri', 'src', 'main.rs').match(/generate_handler!\[([^\]]+)\]/) || [, ''])[1]
  .split(',').map(s => s.trim()).filter(Boolean);

const allowed = [...(read('desktop', 'preload.js').match(/const ALLOWED = \[([\s\S]*?)\]/) || [, ''])[1]
  .matchAll(/['"]([a-z_]+)['"]/g)].map(m => m[1]);

const handled = [...read('desktop', 'main.js').matchAll(/ipcMain\.handle\(\s*['"]([a-z_]+)['"]/g)].map(m => m[1]);

const errors = [];
for (const cmd of wanted) {
  if (!handlers.includes(cmd)) errors.push(`${cmd}: called by ui/ but not in Tauri's generate_handler!`);
  if (!allowed.includes(cmd)) errors.push(`${cmd}: called by ui/ but not in preload.js ALLOWED — the bridge rejects it`);
  if (!handled.includes(cmd)) errors.push(`${cmd}: called by ui/ but no ipcMain.handle in main.js`);
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} shell parity problem(s):`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ both shells implement all ${wanted.length} commands the UI calls: ${wanted.join(', ')}`);
