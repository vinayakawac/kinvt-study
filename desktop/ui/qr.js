/*
 * Kinvt-study — a minimal QR encoder.
 *
 * Written out rather than pulled from a library because the app's CSP is
 * `default-src 'self'`, so a CDN script cannot load, and adding a bundler for
 * one function is not worth it.
 *
 * Byte mode, error correction level L, versions 1–10, which covers a pairing
 * URL of about 120 characters with room to spare. Anything longer throws
 * rather than emitting a code that scans as garbage.
 */
(function (global) {
  'use strict';

  // Total data codewords available at EC level L, indexed by version.
  var DATA_CODEWORDS_L = [0, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
  // EC codewords per block at level L, and the block layout (version 1-10 are
  // all single-group at L).
  var EC_CODEWORDS_L = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
  var EC_BLOCKS_L = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

  var ALIGNMENT = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  /* ---- Galois field arithmetic for Reed-Solomon ---- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;      // the QR generator polynomial
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* Builds (x - α^0)(x - α^1)…(x - α^(degree-1)), highest-degree coefficient
   * first, which is the order rsEncode below reads it in.
   *
   * The two terms used to be the other way round, which produced the whole
   * polynomial reversed. Degree 1 hid it perfectly — the generator there is
   * [1, 1], a palindrome — so the field arithmetic looked sound while every
   * code carried error-correction bytes computed from a mirrored polynomial.
   * The result is a QR code whose syndromes never clear, which no structural
   * test can see and every scanner rejects.
   */
  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];                          // multiply by x
        next[j + 1] ^= gfMul(poly[j], EXP[i]);       // and by α^i
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (var j = 0; j < gen.length - 1; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
    return res;
  }

  /* ---- bit stream ---- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  function encodeData(text, version) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }

    var buf = new BitBuffer();
    buf.put(4, 4);                                   // byte mode
    buf.put(bytes.length, version < 10 ? 8 : 16);
    for (var b = 0; b < bytes.length; b++) buf.put(bytes[b], 8);

    var capacityBits = DATA_CODEWORDS_L[version] * 8;
    if (buf.bits.length > capacityBits) return null;  // needs a bigger version

    buf.put(0, Math.min(4, capacityBits - buf.bits.length));   // terminator
    while (buf.bits.length % 8) buf.bits.push(0);

    var codewords = [];
    for (var k = 0; k < buf.bits.length; k += 8) {
      var v = 0;
      for (var m = 0; m < 8; m++) v = (v << 1) | buf.bits[k + m];
      codewords.push(v);
    }
    // Pad alternately with the two bytes the spec prescribes.
    var pads = [0xec, 0x11];
    var p = 0;
    while (codewords.length < DATA_CODEWORDS_L[version]) codewords.push(pads[p++ % 2]);
    return codewords;
  }

  function interleave(codewords, version) {
    var blocks = EC_BLOCKS_L[version];
    var ecLen = EC_CODEWORDS_L[version];
    var per = Math.floor(codewords.length / blocks);
    var extra = codewords.length % blocks;

    var dataBlocks = [];
    var ecBlocks = [];
    var offset = 0;
    for (var b = 0; b < blocks; b++) {
      var len = per + (b >= blocks - extra ? 1 : 0);
      var block = codewords.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecLen));
    }

    var out = [];
    var maxData = Math.max.apply(null, dataBlocks.map(function (d) { return d.length; }));
    for (var i = 0; i < maxData; i++) {
      for (var j = 0; j < blocks; j++) if (i < dataBlocks[j].length) out.push(dataBlocks[j][i]);
    }
    for (var e = 0; e < ecLen; e++) {
      for (var g = 0; g < blocks; g++) out.push(ecBlocks[g][e]);
    }
    return out;
  }

  /* ---- matrix ---- */
  function buildMatrix(version, codewords) {
    var size = version * 4 + 17;
    var m = [];
    var reserved = [];
    for (var i = 0; i < size; i++) {
      m.push(new Array(size).fill(0));
      reserved.push(new Array(size).fill(false));
    }

    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                   (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                   (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          m[rr][cc] = on ? 1 : 0;
          reserved[rr][cc] = true;
        }
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // timing patterns
    for (var t = 8; t < size - 8; t++) {
      m[6][t] = t % 2 === 0 ? 1 : 0; reserved[6][t] = true;
      m[t][6] = t % 2 === 0 ? 1 : 0; reserved[t][6] = true;
    }

    // alignment patterns
    /* The spec omits exactly three of the centre combinations — the ones that
     * would land on a finder. Everything else is placed, including the two
     * that straddle the timing lines at row and column 6.
     *
     * Testing "is this centre already reserved" looks equivalent and is not:
     * the timing lines are reserved, so it silently also dropped (6, mid) and
     * (mid, 6). Versions 1-6 have only two centres and no middle one, so
     * nothing was ever lost there and every code scanned. Version 7 is the
     * first with three, and every code from there up was missing two
     * alignment patterns and could not be read.
     */
    var centres = ALIGNMENT[version];
    var lastCentre = centres[centres.length - 1];
    for (var a = 0; a < centres.length; a++) {
      for (var b = 0; b < centres.length; b++) {
        var ar = centres[a], ac = centres[b];
        if ((ar === 6 && ac === 6) ||
            (ar === 6 && ac === lastCentre) ||
            (ar === lastCentre && ac === 6)) continue;
        for (var y = -2; y <= 2; y++) {
          for (var x = -2; x <= 2; x++) {
            m[ar + y][ac + x] = (Math.max(Math.abs(y), Math.abs(x)) !== 1) ? 1 : 0;
            reserved[ar + y][ac + x] = true;
          }
        }
      }
    }

    // Version information: versions 7 and up carry their version number in
    // two 6x3 blocks beside the top-right and bottom-left finders, and a
    // decoder reads them to know how big the grid is. Without them everything
    // from version 7 on is unreadable — which is why codes up to version 6
    // scanned and longer ones silently did not.
    if (version >= 7) {
      for (var vr = 0; vr < 6; vr++) {
        for (var vc = 0; vc < 3; vc++) {
          reserved[vr][size - 11 + vc] = true;
          reserved[size - 11 + vc][vr] = true;
        }
      }
    }

    // format information area and the always-dark module
    for (var f = 0; f < 9; f++) {
      if (!reserved[8][f]) reserved[8][f] = true;
      if (!reserved[f][8]) reserved[f][8] = true;
    }
    for (var g = 0; g < 8; g++) {
      reserved[8][size - 1 - g] = true;
      reserved[size - 1 - g][8] = true;
    }
    m[size - 8][8] = 1;
    reserved[size - 8][8] = true;

    // data, snaking upward in two-module columns, skipping the vertical timing
    var bitIndex = 0;
    var total = codewords.length * 8;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                     // the timing column is not data
      for (var row = 0; row < size; row++) {
        var actualRow = ((size - 1 - col) & 2) === 0 ? size - 1 - row : row;
        for (var c2 = 0; c2 < 2; c2++) {
          var cc2 = col - c2;
          if (reserved[actualRow][cc2]) continue;
          var bit = 0;
          if (bitIndex < total) {
            bit = (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
          }
          // Mask 0: the simplest of the eight, and adequate here because the
          // payload is fixed-shape rather than adversarial.
          if ((actualRow + cc2) % 2 === 0) bit ^= 1;
          m[actualRow][cc2] = bit;
        }
      }
    }

    /* Format info for EC level L with mask 0, pre-computed from the spec.
     *
     * Both copies of this had their horizontal and vertical strips swapped:
     * bits 0-5 were written up the column at m[i][8] when the spec puts them
     * along the row at m[8][i], and the second copy was mirrored the same way.
     *
     * Nothing caught it, because a QR code with wrong format bits is still a
     * perfectly well-formed grid — finders, timing and quiet zone all correct,
     * which is exactly what the tests here checked. A decoder reads the format
     * information before anything else, so it got garbage and gave up, and
     * every code this ever produced was unreadable. It went unnoticed because
     * no scanner had ever been pointed at one.
     */
    // format info for EC level L with mask 0, pre-computed from the spec.
    // Indexed from bit 0 up, which lands the same modules as the spec's own
    // bit-14-down ordering: the two halves of each copy are walked in
    // opposite directions, so the reversal cancels. Verified module for module
    // against an independent encoder — see qr.test.mjs.
    var FORMAT = 0x77c4;
    for (var i2 = 0; i2 < 15; i2++) {
      var v = (FORMAT >> i2) & 1;
      if (i2 < 6) m[i2][8] = v;
      else if (i2 < 8) m[i2 + 1][8] = v;
      else if (i2 === 8) m[8][7] = v;
      else m[8][14 - i2] = v;

      if (i2 < 8) m[8][size - 1 - i2] = v;
      else m[size - 15 + i2][8] = v;
    }

    // The version number, plus a 12-bit BCH remainder over the generator the
    // spec names, written into the two blocks reserved above.
    if (version >= 7) {
      var vinfo = version << 12;
      var rem = vinfo;
      for (var b2 = 5; b2 >= 0; b2--) if ((rem >>> (b2 + 12)) & 1) rem ^= 0x1f25 << b2;
      vinfo |= rem & 0xfff;

      for (var i3 = 0; i3 < 18; i3++) {
        var bit = (vinfo >>> i3) & 1;
        var rr2 = Math.floor(i3 / 3);
        var cc3 = i3 % 3;
        m[rr2][size - 11 + cc3] = bit;          // beside the top-right finder
        m[size - 11 + cc3][rr2] = bit;          // and above the bottom-left
      }
    }

    return m;
  }

  function encode(text) {
    for (var version = 1; version <= 10; version++) {
      var codewords = encodeData(text, version);
      if (codewords) return { size: version * 4 + 17, matrix: buildMatrix(version, interleave(codewords, version)) };
    }
    throw new Error('too much data for a version 10 QR code (' + text.length + ' chars)');
  }

  // An SVG rather than a canvas: it scales to any window and needs no
  // measurement, and the card is already styled in CSS.
  function toSvg(text, pixels) {
    var qr = encode(text);
    var quiet = 4;                       // the spec's mandatory quiet zone
    var span = qr.size + quiet * 2;
    var parts = [];
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.matrix[r][c]) parts.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + pixels + '" height="' + pixels +
      '" viewBox="0 0 ' + span + ' ' + span + '" shape-rendering="crispEdges" role="img" aria-label="Pairing code">' +
      '<rect width="' + span + '" height="' + span + '" fill="#ffffff"/>' +
      '<path fill="#000000" d="' + parts.join('') + '"/></svg>';
  }

  global.KinvtQR = { encode: encode, toSvg: toSvg };
})(typeof window !== 'undefined' ? window : globalThis);
