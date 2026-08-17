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

/*
 * Round-tripping through an independent decoder.
 *
 * Everything above checks the code's STRUCTURE — finders in the corners,
 * timing alternating, a quiet zone of the right width. All of it would still
 * pass if the mask were applied wrong or the format bits named the wrong
 * pattern, because those assertions were written from the same understanding
 * as the encoder. qr.js uses mask 0 with hardcoded format bits, which is
 * exactly the kind of thing that looks right and scans as nothing, and no
 * scanner had ever read one of these codes.
 *
 * So: hand the matrix to a decoder that shares no code and no assumptions with
 * it, and require the original string back. jsqr is a devDependency and never
 * ships; see the note in package.json.
 */
import jsQR from 'jsqr';

// jsQR wants pixels, not modules. Several pixels per module, not one: the
// decoder locates a code by sampling, and at 1:1 it finds the smaller grids
// unreliably — which shows up as a test that fails on 'HELLO' and passes on a
// longer URL, i.e. exactly the shape of a bug report about the encoder. The
// quiet zone is not optional either; without it there is no edge to find.
function toPixels({ matrix, size }, scale = 4, quiet = 4) {
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const my = Math.floor(y / scale) - quiet, mx = Math.floor(x / scale) - quiet;
      const dark = my >= 0 && my < size && mx >= 0 && mx < size && matrix[my][mx] === 1;
      const v = dark ? 0 : 255;
      const o = (y * dim + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { data, dim };
}

function roundTrip(text) {
  const { data, dim } = toPixels(QR().encode(text));
  const out = jsQR(data, dim, dim);
  assert.ok(out, `nothing decoded for ${JSON.stringify(text.slice(0, 40))}`);
  return out.data;
}

test('a generated code decodes back to its input', () => {
  assert.equal(roundTrip('HELLO'), 'HELLO');
});

test('a real pairing url survives the round trip', () => {
  // The case that actually matters: full length, mixed case, and the base64url
  // alphabet, which forces byte mode rather than alphanumeric.
  const url = 'kinvt1://192.168.1.42:51234/?k=' + 'Ku4RjZ9O_P0ILwke6modSWjyPBBEUgizIvLoGJD01cs' +
    '&d=dsk-a1b2c3&e=1755300000000';
  assert.equal(roundTrip(url), url);
});

test('every supported version decodes', () => {
  // One code per version, 1 through 10, rather than a handful of lengths.
  // Sampling missed this: versions 1-6 were fine and 7-10 produced nothing a
  // scanner could read, because version 7 is the first with a middle
  // alignment centre and the first to need a version information block.
  // Plain payloads, not a pairing URL: the URL's 26-character prefix already
  // exceeds version 1, so a sweep built on it can never reach the smallest
  // codes. The realistic URL is covered by the test above.
  const seen = new Set();
  for (let n = 1; n < 300; n++) {
    const text = 'x'.repeat(n);
    let enc;
    try { enc = QR().encode(text); } catch { break; }
    const version = (enc.size - 17) / 4;
    if (seen.has(version)) continue;
    seen.add(version);
    assert.equal(roundTrip(text), text, `version ${version} does not decode`);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
