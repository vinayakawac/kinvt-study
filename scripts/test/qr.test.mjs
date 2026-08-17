import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const QR = () => loadModules(['qr.js']).KinvtQR;

test('a short string encodes to a version 1 grid', () => {
  const out = QR().encode('HELLO');
  assert.equal(out.size, 21, 'version 1 is 21x21');
  assert.equal(out.matrix.length, 21);
});

test('the three finder patterns are present and correctly shaped', () => {
  const { matrix: m, size } = QR().encode('HELLO');
  // A finder is a 7x7 ring: dark border, light gap, 3x3 dark core.
  for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    assert.equal(m[r][c], 1, 'outer corner dark');
    assert.equal(m[r + 1][c + 1], 0, 'light ring');
    assert.equal(m[r + 3][c + 3], 1, 'dark core');
  }
});

test('the timing patterns alternate', () => {
  const { matrix: m, size } = QR().encode('HELLO');
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
  }
});

test('a longer string picks a larger version', () => {
  const small = QR().encode('HI');
  const big = QR().encode('x'.repeat(200));
  assert.ok(big.size > small.size, `${big.size} should exceed ${small.size}`);
});

test('a realistic pairing url encodes', () => {
  const url = 'kinvt1://192.168.1.42:51234/?k=' + 'A'.repeat(43) + '&d=dsk-a1b2c3&e=1755300000000';
  const out = QR().encode(url);
  assert.ok(out.size >= 21 && out.size <= 57, `unexpected size ${out.size}`);
});

test('too much data throws rather than emitting a broken code', () => {
  assert.throws(() => QR().encode('x'.repeat(5000)), /too much data/i);
});

test('toSvg produces a self-contained svg with a quiet zone', () => {
  const svg = QR().toSvg('kinvt1://10.0.0.1:5000/?k=abc&d=dsk-1&e=1', 220);
  assert.match(svg, /^<svg xmlns/);
  assert.match(svg, /width="220"/);
  assert.match(svg, /<path fill="#000000"/);
  // size + 8 for the four-module quiet zone on each side
  const viewBox = svg.match(/viewBox="0 0 (\d+)/)[1];
  assert.equal(Number(viewBox), QR().encode('kinvt1://10.0.0.1:5000/?k=abc&d=dsk-1&e=1').size + 8);
});
