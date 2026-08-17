// Every UI module must be loaded by every page, in a valid order.
//
// A module added to the folder but left out of a page's <script> list fails
// silently: the page loads fine, the global is simply undefined, and the first
// call throws at runtime in front of the user rather than here.
//
// Order matters as much as presence. These modules capture their dependencies
// at load time (`var M = global.KinvtMerge`), so loading progress.js before
// merge.js binds undefined and every later call fails.
import fs from 'node:fs';
import path from 'node:path';

const UI = path.join('desktop', 'ui');
const REQUIRED = ['merge.js', 'storage.js', 'progress.js', 'selection.js', 'quiz-engine.js',
                  'sync-crypto.js', 'sync-pairing.js', 'sync-session.js'];
const PAGES = ['index.html', 'settings.html', '_preview.html'];

// before -> must load ahead of after
const ORDER = [
  ['merge.js', 'progress.js'],
  ['storage.js', 'progress.js'],
  ['progress.js', 'selection.js'],
  ['selection.js', 'quiz-engine.js'],
  ['quiz-engine.js', 'sync-session.js'],
  ['sync-crypto.js', 'sync-pairing.js'],
  ['sync-pairing.js', 'sync-session.js'],
  ['quiz-engine.js', 'app.js'],
  ['quiz-engine.js', 'settings.js']
];

const errors = [];

for (const page of PAGES) {
  const html = fs.readFileSync(path.join(UI, page), 'utf8');
  const loaded = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m => m[1])
    .filter(s => !s.startsWith('shim/'));

  for (const mod of REQUIRED) {
    if (!loaded.includes(mod)) errors.push(`${page}: does not load ${mod}`);
  }

  for (const [before, after] of ORDER) {
    const b = loaded.indexOf(before);
    const a = loaded.indexOf(after);
    if (b === -1 || a === -1) continue;      // that page does not use the pair
    if (b > a) errors.push(`${page}: ${before} must load before ${after}`);
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ ${PAGES.length} pages load all ${REQUIRED.length} UI modules in a valid order`);
