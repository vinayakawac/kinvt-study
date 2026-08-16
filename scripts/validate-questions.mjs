// Gate for every question bank, generated or hand-written. The Action
// auto-merges when this passes, so this is the only thing standing between a
// malformed or duplicated question and every installed copy of the app.
//
// It cannot check whether a fact is TRUE — no script can. It checks the
// failures that are mechanically detectable, and the `source` URL is what
// lets a human check the rest.
//
// The topic id comes from the filename, so this works for all 16 banks. It
// used to hard-code 'current-affairs', which silently made it useless as the
// gate for the other 15.
//
// `source` is a warning by default and an error under --require-source: the
// questions written before sources were required would otherwise fail their
// own gate. New content is written with the flag on.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const requireSource = args.includes('--require-source');
const file = args.find(a => !a.startsWith('--'));
if (!file) {
  console.error('usage: validate-questions.mjs <path> [--require-source]');
  process.exit(2);
}

const topicId = path.basename(file, '.json');

const errors = [];
const warn = [];
let data;

try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ ${file} is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(data.questions)) errors.push('`questions` must be an array');

const seenIds = new Set();
const seenText = new Set();

(data.questions || []).forEach((q, i) => {
  const at = `questions[${i}]${q?.id ? ` (${q.id})` : ''}`;

  if (!q.id || typeof q.id !== 'string') errors.push(`${at}: missing string id`);
  else if (seenIds.has(q.id)) errors.push(`${at}: duplicate id`);
  else seenIds.add(q.id);

  if (!q.question || typeof q.question !== 'string') errors.push(`${at}: missing question text`);
  else {
    // Same question worded identically twice is a generation artifact.
    const norm = q.question.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenText.has(norm)) errors.push(`${at}: duplicate question text`);
    else seenText.add(norm);
  }

  if (!Array.isArray(q.options) || q.options.length !== 4) {
    errors.push(`${at}: needs exactly 4 options`);
  } else {
    if (new Set(q.options.map(String)).size !== 4) errors.push(`${at}: options are not distinct`);
    if (q.options.some(o => typeof o !== 'string' || !o.trim())) errors.push(`${at}: blank option`);
  }

  // The single most dangerous field: an out-of-range or missing answer index
  // silently makes every attempt wrong.
  if (!Number.isInteger(q.answer)) errors.push(`${at}: answer must be an integer index`);
  else if (!Array.isArray(q.options) || q.answer < 0 || q.answer >= q.options.length) {
    errors.push(`${at}: answer ${q.answer} is out of range`);
  }

  const expl = String(q.explanation || '').trim();
  if (!expl) {
    errors.push(`${at}: no explanation — the wrong-answer feedback would be blank`);
  } else if (expl.length < 40) {
    errors.push(`${at}: explanation too short to teach anything (${expl.length} chars, need 40)`);
  }

  if (!q.source || !/^https?:\/\//.test(String(q.source))) {
    const msg = `${at}: needs a source URL so the fact can be checked by a human`;
    if (requireSource) errors.push(msg); else warn.push(msg);
  }

  if (q.category !== topicId) {
    errors.push(`${at}: category is "${q.category}", expected "${topicId}" to match the filename`);
  }
});

warn.forEach(w => console.log(`⚠ ${w}`));

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s) in ${file}:`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ ${file}: ${data.questions.length} questions passed validation`);
