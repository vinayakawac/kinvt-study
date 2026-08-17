import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage, CORE } from './harness.mjs';

const load = (seed) => loadModules(CORE, { localStorage: makeLocalStorage(seed) });

test('KinvtQuiz still exposes everything app.js and settings.js call', () => {
  const { KinvtQuiz } = load();
  for (const name of [
    'DEFAULT_SETTINGS', 'DEFAULT_STATS', 'getSettings', 'setSettings',
    'getStats', 'recordResult', 'resetStats', 'recordAnswer', 'reviewCount',
    'loadLibrary', 'buildQuiz', 'syncContent', 'lastSyncAt',
    'topicBreakdown', 'exportPayload', 'importPayload', 'streak',
    'getSnoozeUntil', 'setSnoozeUntil'
  ]) {
    assert.ok(name in KinvtQuiz, `KinvtQuiz.${name} is missing`);
  }
});

test('defaults cover every topic in the shipped library', async () => {
  const { KinvtQuiz } = load();
  const fs = await import('node:fs');
  const library = JSON.parse(fs.readFileSync('desktop/ui/library.json', 'utf8'));
  const defaults = KinvtQuiz.DEFAULT_SETTINGS.topics;
  for (const cat of library) {
    assert.ok(cat.id in defaults, `${cat.id} is in library.json but has no default — it could never be enabled`);
  }
  assert.equal(Object.keys(defaults).length, library.length, 'no orphan defaults either');
});

test('new settings default on, existing ones unchanged', () => {
  const s = load().KinvtQuiz.getSettings();
  assert.equal(s.adaptive, true);
  assert.equal(s.respectDnd, true);
  assert.equal(s.intervalMin, 30);
  assert.equal(s.quietStart, 1320);
  assert.equal(s.quietEnd, 420);
});

test('settings stored by an older version still load', () => {
  const { KinvtQuiz } = load();
  KinvtQuiz.setSettings({ intervalMin: 90, topics: { upsc: true } });
  const s = KinvtQuiz.getSettings();
  assert.equal(s.intervalMin, 90);
  assert.equal(s.adaptive, true, 'a missing new field falls back to its default');
  assert.equal(s.topics.ssc, false, 'topics are topped up from defaults');
});

test('saving settings stamps a time, so a sync can order them', () => {
  const { KinvtQuiz } = load();
  const before = Date.now();
  KinvtQuiz.setSettings(KinvtQuiz.getSettings());
  assert.ok(KinvtQuiz.getSettings().updatedAt >= before);
});

test('snooze round-trips', () => {
  const { KinvtQuiz } = load();
  assert.equal(KinvtQuiz.getSnoozeUntil(), 0);
  KinvtQuiz.setSnoozeUntil(1755300000000);
  assert.equal(KinvtQuiz.getSnoozeUntil(), 1755300000000);
});

test('buildQuiz resolves null when no topic is selected', async () => {
  const { KinvtQuiz } = load();
  const s = KinvtQuiz.getSettings();
  Object.keys(s.topics).forEach(k => { s.topics[k] = false; });
  KinvtQuiz.setSettings(s);
  assert.equal(await KinvtQuiz.buildQuiz(), null);
});

test('buildQuiz assembles a real quiz from the shipped banks', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  // Serve the real library and banks off disk, exactly as the webview fetches
  // them, so this exercises the shipped content rather than a fixture.
  const fetchImpl = (url) => {
    const rel = String(url).split('?')[0];
    const file = path.join('desktop', 'ui', rel);
    if (!fs.existsSync(file)) return Promise.resolve({ ok: false, json: () => Promise.reject(new Error('404')) });
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };

  const win = loadModules(CORE, { localStorage: makeLocalStorage(), fetchImpl });
  const s = win.KinvtQuiz.getSettings();
  Object.keys(s.topics).forEach(k => { s.topics[k] = false; });
  s.topics.upsc = true;
  s.perQuiz = 5;
  win.KinvtQuiz.setSettings(s);

  const quiz = await win.KinvtQuiz.buildQuiz();
  assert.ok(quiz, 'a quiz was built');
  assert.equal(quiz.questions.length, 5);
  assert.equal(new Set(quiz.questions.map(q => q.id)).size, 5, 'no duplicates in one popup');
  assert.match(quiz.title, /UPSC/);
  for (const q of quiz.questions) {
    assert.equal(q.options.length, 4);
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.ok(q.explanation && q.explanation.length > 0);
  }
});
