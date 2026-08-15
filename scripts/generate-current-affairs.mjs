// Drafts current-affairs MCQs from Wikipedia's Current Events portal.
//
// Wikipedia is the source rather than a news API because its entries are
// dated, already summarised, and every item carries citations — which is what
// makes the generated question checkable afterwards.
//
// The model is told to work ONLY from the supplied text. It still cannot be
// trusted on facts, which is why every question must carry a source URL and
// why validate-questions.mjs gates the merge.
import fs from 'node:fs';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(2); }

const COUNT = Number(process.env.QUESTION_COUNT || 15);
const OUT = process.argv[2] || 'data/current-affairs.json';
const RETAIN_MONTHS = 12;

// --- 1. gather recent events -------------------------------------------------
const now = new Date();
const months = [0, 1].map(back => {
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return `${d.toLocaleString('en-US', { month: 'long' })}_${d.getFullYear()}`;
});

let source = '';
const sourceUrls = [];
for (const m of months) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/Portal:Current_events/${m}`;
  const page = `https://en.wikipedia.org/wiki/Portal:Current_events/${m}`;
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=Portal:Current_events/${m}&prop=wikitext&format=json&origin=*`);
    if (!res.ok) continue;
    const j = await res.json();
    const text = j?.parse?.wikitext?.['*'];
    if (text) { source += `\n\n=== ${m.replace('_', ' ')} ===\n` + text.slice(0, 40000); sourceUrls.push(page); }
  } catch (e) {
    console.warn(`could not fetch ${m}: ${e.message}`);
  }
}
if (!source.trim()) { console.error('no source material fetched — aborting rather than inventing questions'); process.exit(1); }

// --- 2. load the existing bank so we can avoid repeats and prune -------------
let existing = { name: 'Current Affairs', description: 'Recent events · verified facts', questions: [] };
try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
const existingQs = existing.questions || [];
const existingText = existingQs.map(q => q.question).join('\n');

// --- 3. draft ----------------------------------------------------------------
const prompt = `You are writing multiple-choice questions for Indian competitive-exam preparation (UPSC/KPSC style current affairs).

Below is raw wikitext from Wikipedia's Current Events portal. Write exactly ${COUNT} questions based ONLY on facts stated in this text. Do not use any outside knowledge. If the text does not support a clear, unambiguous question, write fewer.

Rules:
- Exactly 4 options, exactly one unambiguously correct.
- The other 3 must be plausible but clearly wrong to someone who knows the fact.
- Prefer events with lasting exam relevance (appointments, treaties, indices, awards, launches, summits) over transient news.
- Avoid anything phrased relative to now ("recently", "last week") — the question must still read correctly in a year.
- "explanation" must be one sentence giving the fact and why it matters.
- "source" must be a real Wikipedia URL supporting the fact.
- Do NOT repeat any of these existing questions:
${existingText.slice(0, 4000)}

Return ONLY a JSON array, no prose, each element:
{"question":"...","options":["..","..","..",".."],"answer":<0-3>,"explanation":"...","topic":"...","difficulty":"easy|medium|hard","source":"https://en.wikipedia.org/..."}

SOURCE TEXT:
${source.slice(0, 60000)}`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  })
});
if (!res.ok) { console.error(`Anthropic API ${res.status}: ${await res.text()}`); process.exit(1); }
const body = await res.json();
const raw = body.content?.[0]?.text ?? '';

let drafted;
try {
  drafted = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
} catch (e) {
  console.error('model did not return parseable JSON:', e.message);
  process.exit(1);
}
if (!Array.isArray(drafted) || !drafted.length) { console.error('no questions drafted'); process.exit(1); }

// --- 4. stamp ids and dates, prune old, write --------------------------------
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
const used = new Set(existingQs.map(q => q.id));
let n = 1;
const fresh = drafted.map(q => {
  let id;
  do { id = `ca-${stamp}-${String(n++).padStart(2, '0')}`; } while (used.has(id));
  used.add(id);
  return { id, category: 'current-affairs', topic: q.topic || 'Current Affairs',
           difficulty: q.difficulty || 'medium', question: q.question, options: q.options,
           answer: q.answer, explanation: q.explanation, source: q.source, addedAt: now.toISOString().slice(0, 10) };
});

// Current affairs stop being current. Drop anything older than the window,
// but never let pruning empty the bank.
const cutoff = new Date(now.getFullYear(), now.getMonth() - RETAIN_MONTHS, 1).toISOString().slice(0, 10);
const kept = existingQs.filter(q => !q.addedAt || q.addedAt >= cutoff);
const pruned = existingQs.length - kept.length;

existing.questions = (kept.length ? kept : existingQs).concat(fresh);
fs.writeFileSync(OUT, JSON.stringify(existing, null, 2) + '\n');

console.log(`drafted ${fresh.length}, pruned ${pruned}, total ${existing.questions.length}`);
console.log('sources:\n' + sourceUrls.map(u => '  ' + u).join('\n'));
