// Regenerates the root-level sync feed from desktop/ui.
//
// The question banks exist in two places, and both are load-bearing:
//
//   desktop/ui/data/  bundled into the .exe — what a fresh install ships with
//   data/             the sync feed — every installed copy fetches this from
//                     raw.githubusercontent.com once a day (REMOTE_BASE in
//                     quiz-engine.js) and merges it by question id
//
// That is why content can improve without shipping a new binary. The failure
// mode is silent and nasty: edit only desktop/ui and the feed freezes, so
// existing installs keep serving stale questions forever while the repo looks
// correct. Edit only the feed and new installs ship stale ones instead.
//
// desktop/ui is the source of truth. This copies it outward.
//
// usage: node scripts/sync-feed.mjs [--check]
//        --check verifies the feed is up to date without writing (for CI).
import fs from 'node:fs';
import path from 'node:path';

const check = process.argv.includes('--check');
const UI = path.join('desktop', 'ui');

const library = fs.readFileSync(path.join(UI, 'library.json'), 'utf8');
const targets = [{ from: path.join(UI, 'library.json'), to: 'library.json', body: library }];

for (const cat of JSON.parse(library)) {
  const from = path.join(UI, cat.file);
  targets.push({ from, to: cat.file, body: fs.readFileSync(from, 'utf8') });
}

const stale = [];
for (const t of targets) {
  const current = fs.existsSync(t.to) ? fs.readFileSync(t.to, 'utf8') : null;
  if (current === t.body) continue;
  stale.push(t.to);
  if (!check) {
    fs.mkdirSync(path.dirname(t.to), { recursive: true });
    fs.writeFileSync(t.to, t.body);
  }
}

if (check) {
  if (stale.length) {
    console.error(`\n✗ the sync feed is stale — ${stale.length} file(s) differ from desktop/ui:`);
    stale.forEach(f => console.error('  - ' + f));
    console.error('\nRun: node scripts/sync-feed.mjs');
    console.error('Without this, installed copies keep fetching the old questions.');
    process.exit(1);
  }
  console.log(`✓ sync feed matches desktop/ui (${targets.length} files)`);
} else {
  console.log(stale.length
    ? `✓ regenerated ${stale.length} feed file(s)`
    : `✓ sync feed already up to date (${targets.length} files)`);
}
