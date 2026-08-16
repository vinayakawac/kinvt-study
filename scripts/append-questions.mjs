// Appends a batch of hand-written questions to a topic bank.
//
// Batching exists because filling six topics to 150 is 770 questions, which
// is not one sitting. Ids are assigned here rather than by hand so batches
// can't collide, and near-duplicate wording is rejected on the way in — the
// most likely failure when writing a large bank across many sessions is
// asking the same thing twice.
//
// usage: node scripts/append-questions.mjs <topic-id> <batch.json>
import fs from 'node:fs';
import path from 'node:path';

const [topicId, batchFile] = process.argv.slice(2);
if (!topicId || !batchFile) {
  console.error('usage: append-questions.mjs <topic-id> <batch.json>');
  process.exit(2);
}

const PREFIX = {
  upsc: 'up', kpsc: 'kp', ssc: 'ss', banking: 'bk', railways: 'rw', defence: 'df'
};
const prefix = PREFIX[topicId];
if (!prefix) { console.error(`unknown topic "${topicId}"`); process.exit(2); }

const bankFile = path.join('desktop', 'ui', 'data', `${topicId}.json`);
const bank = JSON.parse(fs.readFileSync(bankFile, 'utf8'));
const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const seenText = new Set(bank.questions.map(q => norm(q.question)));

// Continue from the highest existing number rather than the count, so a bank
// that ever had a question removed still can't reissue a retired id.
let next = bank.questions.reduce((max, q) => {
  const n = parseInt(String(q.id).split('-')[1], 10);
  return Number.isFinite(n) && n > max ? n : max;
}, 0) + 1;

let added = 0;
const skipped = [];

for (const q of batch) {
  if (seenText.has(norm(q.question))) { skipped.push(q.question.slice(0, 60)); continue; }
  seenText.add(norm(q.question));
  bank.questions.push({
    id: `${prefix}-${String(next++).padStart(3, '0')}`,
    category: topicId,
    topic: q.topic,
    difficulty: q.difficulty || 'medium',
    question: q.question,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation,
    source: q.source
  });
  added++;
}

fs.writeFileSync(bankFile, JSON.stringify(bank, null, 2) + '\n');

skipped.forEach(s => console.log(`  skipped duplicate: ${s}…`));
console.log(`${topicId}: +${added} → ${bank.questions.length}/150`);
