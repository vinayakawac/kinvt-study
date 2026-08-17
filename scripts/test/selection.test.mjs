import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

const MODULES = ['merge.js', 'storage.js', 'progress.js', 'selection.js'];

function load(stats) {
  const seed = stats ? { 'kinvt.stats': JSON.stringify(stats) } : {};
  return loadModules(MODULES, { localStorage: makeLocalStorage(seed) }).KinvtSelection;
}

const dev = (byDevice) => ({ byDevice });
const statsWith = (byTopic, recent = []) =>
  ({ schema: 2, deviceId: 'dsk-1', byDevice: {}, byTopic, recent, streakByDevice: {} });
const topic = (answered, correct) => dev({ 'dsk-1': { answered, correct } });
const q = (id, category, difficulty) => ({ id, category, difficulty });

// A small deterministic PRNG so distribution assertions are reproducible.
function prng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('an unattempted topic carries neutral weight', () => {
  assert.equal(load().topicWeight('upsc'), 1);
});

test('weight rises as accuracy falls, capped at 2', () => {
  const Sel = load(statsWith({
    strong: topic(10, 9), weak: topic(10, 2), hopeless: topic(10, 0)
  }));
  assert.ok(Math.abs(Sel.topicWeight('strong') - 1.1) < 1e-9);
  assert.ok(Math.abs(Sel.topicWeight('weak') - 1.8) < 1e-9);
  assert.equal(Sel.topicWeight('hopeless'), Sel.MAX_WEIGHT);
});

test('a topic below the attempt floor stays neutral despite bad accuracy', () => {
  assert.equal(load(statsWith({ fresh: topic(3, 0) })).topicWeight('fresh'), 1);
});

test('targetBand defaults to medium without enough history', () => {
  assert.equal(load().targetBand(), 'medium');
  assert.equal(load(statsWith({}, [1, 1, 0])).targetBand(), 'medium');
});

test('targetBand tracks recent accuracy', () => {
  assert.equal(load(statsWith({}, Array(10).fill(1))).targetBand(), 'hard');
  assert.equal(load(statsWith({}, [1, 1, 1, 0, 1, 0, 1, 0, 1, 1])).targetBand(), 'medium');
  assert.equal(load(statsWith({}, [0, 0, 0, 0, 1, 0, 0, 0, 1, 0])).targetBand(), 'easy');
});

test('pick returns the requested count without duplicates', () => {
  const Sel = load();
  const bank = Array.from({ length: 20 }, (_, i) => q(`q-${i}`, 'upsc', 'medium'));
  const got = Sel.pick(bank, 3, { random: prng(1) });
  assert.equal(got.length, 3);
  assert.equal(new Set(got.map(x => x.id)).size, 3);
});

test('pick never returns an excluded question', () => {
  const Sel = load();
  const bank = [q('a', 'upsc', 'easy'), q('b', 'upsc', 'easy'), q('c', 'upsc', 'easy')];
  const got = Sel.pick(bank, 2, { exclude: { a: true }, random: prng(2) });
  assert.equal(got.length, 2);
  assert.ok(!got.some(x => x.id === 'a'));
});

test('pick caps at the bank size rather than looping forever', () => {
  assert.equal(load().pick([q('a', 'upsc', 'easy')], 5, { random: prng(3) }).length, 1);
});

test('pick on an empty bank returns nothing', () => {
  assert.deepEqual(load().pick([], 3, { random: prng(4) }), []);
});

test('adaptive picking favours the weaker topic over many draws', () => {
  const Sel = load(statsWith({ strong: topic(20, 20), weak: topic(20, 0) }));
  const bank = [];
  for (let i = 0; i < 50; i++) bank.push(q(`s-${i}`, 'strong', 'medium'));
  for (let i = 0; i < 50; i++) bank.push(q(`w-${i}`, 'weak', 'medium'));

  const random = prng(11);
  let weak = 0;
  for (let t = 0; t < 400; t++) {
    for (const p of Sel.pick(bank, 1, { random })) if (p.category === 'weak') weak++;
  }
  assert.ok(weak > 220, `expected the weak topic to dominate, got ${weak}/400`);
});

test('adaptive picking favours the target difficulty band', () => {
  const Sel = load(statsWith({}, Array(10).fill(1)));   // band = hard
  const bank = [];
  for (let i = 0; i < 50; i++) bank.push(q(`e-${i}`, 'upsc', 'easy'));
  for (let i = 0; i < 50; i++) bank.push(q(`h-${i}`, 'upsc', 'hard'));

  const random = prng(7);
  let hard = 0;
  for (let t = 0; t < 400; t++) {
    for (const p of Sel.pick(bank, 1, { random })) if (p.difficulty === 'hard') hard++;
  }
  assert.ok(hard > 220, `expected hard questions to dominate, got ${hard}/400`);
});

test('adaptive:false ignores weighting entirely', () => {
  const Sel = load(statsWith({ strong: topic(20, 20), weak: topic(20, 0) }));
  const bank = [];
  for (let i = 0; i < 50; i++) bank.push(q(`s-${i}`, 'strong', 'medium'));
  for (let i = 0; i < 50; i++) bank.push(q(`w-${i}`, 'weak', 'medium'));

  const random = prng(3);
  let weak = 0;
  for (let t = 0; t < 400; t++) {
    for (const p of Sel.pick(bank, 1, { adaptive: false, random })) if (p.category === 'weak') weak++;
  }
  assert.ok(weak > 150 && weak < 250, `expected a roughly even split, got ${weak}/400`);
});
