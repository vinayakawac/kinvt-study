// Checks that every topic in library.json is wired up everywhere it needs to be.
//
// Adding a topic touches four files, and forgetting one fails quietly rather
// than loudly: a missing settings entry means the topic can never be enabled,
// a missing icon renders a blank square, and a missing bank file makes
// buildQuiz drop the topic with an empty catch. None of that throws, so
// without this check a half-wired topic ships looking fine.
import fs from 'node:fs';
import path from 'node:path';

const UI = path.join('desktop', 'ui');
const library = JSON.parse(fs.readFileSync(path.join(UI, 'library.json'), 'utf8'));
const engine = fs.readFileSync(path.join(UI, 'quiz-engine.js'), 'utf8');
const settings = fs.readFileSync(path.join(UI, 'settings.js'), 'utf8');

const errors = [];
const seen = new Set();
let total = 0;

for (const cat of library) {
  const at = `library.json (${cat.id})`;

  if (seen.has(cat.id)) errors.push(`${at}: duplicate topic id`);
  seen.add(cat.id);

  for (const field of ['id', 'label', 'icon', 'group', 'blurb', 'file']) {
    if (!cat[field]) errors.push(`${at}: missing "${field}"`);
  }

  const bankPath = path.join(UI, cat.file);
  if (!fs.existsSync(bankPath)) {
    errors.push(`${at}: bank file ${cat.file} does not exist`);
  } else {
    const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
    const n = bank.questions?.length ?? 0;
    total += n;
    if (!n) errors.push(`${at}: bank has no questions`);
    // The filename drives the category check in validate-questions.mjs, so a
    // mismatch here would make every question in the bank fail that gate.
    if (path.basename(cat.file, '.json') !== cat.id) {
      errors.push(`${at}: filename must match the topic id`);
    }
  }

  if (!engine.includes(`'${cat.id}'`)) {
    errors.push(`${at}: not listed in DEFAULT_SETTINGS.topics in quiz-engine.js — it could never be enabled`);
  }
  if (!settings.includes(`${cat.icon}:`) && !settings.includes(`'${cat.icon}'`)) {
    errors.push(`${at}: icon "${cat.icon}" is not defined in the ICONS map in settings.js`);
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ ${library.length} topics wired correctly · ${total} questions total`);
