// Generates icon.png (256x256) and icon.ico in the brand palette, with no
// image dependencies — a hand-rolled PNG encoder over Node's zlib, plus an
// ICO wrapper (the ICO format can embed a PNG directly).
// Run: node icons/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const BG = [28, 27, 25];      // #1c1b19 charcoal
const FG = [245, 241, 221];   // #f5f1dd cream

function crc32(buf) {
  const table = crc32.t || (crc32.t = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// Coverage-based antialiasing: sample each pixel on a 3x3 grid so the
// rounded corners and the ring read as smooth rather than stair-stepped.
function coverage(x, y, test) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      if (test(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++;
    }
  }
  return hits / 9;
}

function inRoundedRect(px, py, r) {
  const x = Math.min(px, SIZE - px);
  const y = Math.min(py, SIZE - py);
  if (x > r || y > r) return px >= 0 && px <= SIZE && py >= 0 && py <= SIZE;
  const dx = r - x, dy = r - y;
  return dx * dx + dy * dy <= r * r;
}

// A ring plus a dot — the same mark the app's logo uses.
function inGlyph(px, py) {
  const cx = SIZE / 2, cy = SIZE / 2 - SIZE * 0.045;
  const d = Math.hypot(px - cx, py - cy);
  const inRing = d <= SIZE * 0.30 && d >= SIZE * 0.30 - SIZE * 0.055;
  const dotD = Math.hypot(px - cx, py - (cy + SIZE * 0.30 + SIZE * 0.085));
  return inRing || dotD <= SIZE * 0.045;
}

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const row = y * (1 + SIZE * 4);
  raw[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const bgA = coverage(x, y, (a, b) => inRoundedRect(a, b, SIZE * 0.22));
    const fgA = coverage(x, y, inGlyph) * bgA;
    // Composite cream glyph over charcoal plate, premultiplied by plate alpha.
    const o = row + 1 + x * 4;
    raw[o]     = Math.round(BG[0] * (1 - fgA) + FG[0] * fgA);
    raw[o + 1] = Math.round(BG[1] * (1 - fgA) + FG[1] * fgA);
    raw[o + 2] = Math.round(BG[2] * (1 - fgA) + FG[2] * fgA);
    raw[o + 3] = Math.round(255 * bgA);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'icon.png'), png);

// ICO: header + one directory entry + the PNG payload. Width/height bytes
// are 0 to mean 256 — the field is a single byte, so 256 does not fit.
const h = Buffer.alloc(6);
h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
const e = Buffer.alloc(16);
e[0] = 0; e[1] = 0; e[2] = 0; e[3] = 0;
e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
e.writeUInt32LE(png.length, 8); e.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([h, e, png]));

console.log(`icon.png + icon.ico written (${SIZE}x${SIZE}, ${png.length} bytes)`);
