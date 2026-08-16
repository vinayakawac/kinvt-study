// Tops every topic up to a target question count.
//
// Runs in batches and re-reads what already exists between them, so it can be
// interrupted and resumed without duplicating work — filling 16 topics to 150
// is thousands of questions and will not complete in one uninterrupted call.
//
// Static topics (history, polity, geography…) are generated from the model's
// subject knowledge rather than a news feed, but the constraints that matter
// are unchanged: a source URL per question, and validate-questions.mjs as the
// gate. Nothing here can verify a fact is true — see docs/AUTOMATION.md.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(2); }

const TARGET = Number(process.env.TARGET_COUNT || 150);
const BATCH = Number(process.env.BATCH_SIZE || 25);      // per API call
const ONLY = process.env.ONLY_TOPIC || '';               // optional single topic
const MAX_CALLS = Number(process.env.MAX_CALLS || 200);  // cost ceiling
// Overridable so a model upgrade is an input change, not a code change.
const MODEL = process.env.MODEL || 'claude-sonnet-5';

// Content lives under desktop/ui and nowhere else. This used to read
// library.json from the repo root, where it has never existed, so the script
// threw before generating anything — which is why this pipeline had never
// successfully run.
const UI_DIR = path.join('desktop', 'ui');
const library = JSON.parse(fs.readFileSync(path.join(UI_DIR, 'library.json'), 'utf8'));
let calls = 0;

const SUBJECT_HINTS = {
  'upsc': 'UPSC Civil Services Prelims: polity, modern history, geography, economy, environment, governance',
  'kpsc': 'Karnataka KAS/KPSC: Karnataka history, geography, culture, administration, plus general studies',
  'ssc': 'SSC CGL/CHSL: reasoning, quantitative aptitude, English usage, general awareness',
  'banking': 'IBPS/SBI/RBI: banking terms, monetary policy, financial institutions, regulators',
  'railways': 'RRB NTPC/Group D: Indian Railways, general science, general awareness',
  'defence': 'NDA/CDS/AFCAT: Indian armed forces, defence exercises, equipment, military history',
  'land-surveyor': 'KEA Karnataka Land Surveyor (RPC): chain/compass/plane table/theodolite/levelling, contours, tacheometry, total station, GPS, GIS and remote sensing, plus physics, arithmetic, algebra, geometry and computer applications',
  'vao': 'KEA Karnataka Village Administrative Officer (RPC): Karnataka land revenue administration, records of rights and mutation, the Bhoomi land-records system, revenue hierarchy, Karnataka GK, general English and computer knowledge',
  'general-knowledge': 'everyday general knowledge: India and the world, science, geography, culture',
  'current-affairs': 'notable events of the last two years with lasting exam relevance',
  'constitution-polity': 'Indian Constitution: articles, amendments, schedules, constitutional bodies',
  'indian-history': 'ancient, medieval and modern Indian history including the freedom struggle',
  'geography': 'Indian and world geography: physical, economic, rivers, climate, resources',
  'economy': 'Indian economy: budget, banking, planning, indices, institutions',
  'science-tech': 'physics, chemistry, biology, space and IT with an Indian exam slant',
  'environment': 'ecology, biodiversity, conventions, national parks, climate policy',
  'sports': 'Olympics, cricket, major tournaments, Indian sporting achievements',
  'karnataka-gk': 'Karnataka: districts, culture, economy, notable people, monuments'
};

async function draft(topic, existing, want) {
  const existingText = existing.map(q => q.question).join('\n').slice(0, 6000);
  const prompt = `Write ${want} multiple-choice questions for Indian competitive-exam preparation.

Subject: ${SUBJECT_HINTS[topic.id] || topic.label}

Rules:
- Exactly 4 options, exactly one unambiguously correct answer.
- Distractors must be plausible but clearly wrong to someone who knows the fact.
- Only well-established facts. If you are not confident a fact is correct, skip it and write fewer.
- No time-relative wording ("recently", "currently", "last year") — it must read correctly years from now.
- Vary difficulty: roughly 40% easy, 40% medium, 20% hard.
- "explanation" is one sentence: the fact, and why the wrong answers are wrong where useful.
- "source" must be a real Wikipedia URL supporting the fact.
- Do NOT repeat or lightly reword any of these existing questions:
${existingText}

Return ONLY a JSON array, no prose:
[{"question":"...","options":["..","..","..",".."],"answer":<0-3>,"explanation":"...","topic":"...","difficulty":"easy|medium|hard","source":"https://en.wikipedia.org/..."}]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] })
  });
  calls++;
  if (!res.ok) { console.error(`  API ${res.status}: ${(await res.text()).slice(0, 300)}`); return []; }
  const raw = (await res.json()).content?.[0]?.text ?? '';
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error('  unparseable model output, skipping batch');
    return [];
  }
}

const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

for (const topic of library) {
  if (ONLY && topic.id !== ONLY) continue;

  const file = path.join(UI_DIR, topic.file);
  let bank;
  try { bank = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { bank = { name: topic.label, description: topic.blurb, questions: [] }; }

  const seenText = new Set(bank.questions.map(q => norm(q.question)));
  const seenIds = new Set(bank.questions.map(q => q.id));
  let added = 0;

  while (bank.questions.length < TARGET && calls < MAX_CALLS) {
    const want = Math.min(BATCH, TARGET - bank.questions.length);
    process.stdout.write(`${topic.id}: ${bank.questions.length}/${TARGET} — drafting ${want}…\n`);

    const drafted = await draft(topic, bank.questions, want);
    if (!drafted.length) { console.error(`  no usable output for ${topic.id}, moving on`); break; }

    let n = bank.questions.length + 1;
    for (const q of drafted) {
      // Cheap structural screen; validate-questions.mjs is still the real gate.
      if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) continue;
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) continue;
      if (new Set(q.options.map(String)).size !== 4) continue;
      if (seenText.has(norm(q.question))) continue;      // dedupe across batches

      let id;
      do { id = `${topic.id}-${String(n++).padStart(3, '0')}`; } while (seenIds.has(id));
      seenIds.add(id);
      seenText.add(norm(q.question));

      bank.questions.push({
        id, category: topic.id, topic: q.topic || topic.label,
        difficulty: q.difficulty || 'medium', question: q.question,
        options: q.options, answer: q.answer,
        explanation: q.explanation || '', source: q.source || ''
      });
      added++;
    }

    // Write after every batch so an interrupted run keeps its progress.
    // There is one location for the banks; the old mirror-to-desktop/ui step
    // existed only to paper over the wrong primary path.
    fs.writeFileSync(file, JSON.stringify(bank, null, 2) + '\n');
  }

  console.log(`${topic.id}: ${bank.questions.length} questions (+${added})`);
}

console.log(`\ndone — ${calls} API calls used`);
