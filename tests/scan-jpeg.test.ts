import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findDocument, scanImage } from '../src/core/scan';
import type { Img, Quad } from '../src/core/scan';
import { decodeJpeg, encodeJpeg, jpegDataUrl } from '../src/data/jpegimg';

/** A picture of a sheet with lines of print on a darker table, as a phone would hand over after shrinking it. */
function photo(w: number, h: number, sheet: Quad): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = sheet[i], b = sheet[(i + 1) % 4];
      const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) { const s = Math.sign(c); if (sign && s !== sign) return false; sign = s; }
    }
    return true;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const v = inside(x, y) ? (y % 18 < 3 && x % 40 < 28 ? 40 : 225) : 60;
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
const px = (xs: [number, number][]): Quad => xs.map(([x, y]) => ({ x, y })) as Quad;

test('a JPEG written and read back keeps its size and its light and dark areas', () => {
  const img = photo(200, 120, px([[20, 10], [180, 10], [180, 110], [20, 110]]));
  const back = decodeJpeg(encodeJpeg(img, 90));
  assert.equal(back.width, 200); assert.equal(back.height, 120);
  assert.equal(back.data.length, 200 * 120 * 4);
  const at = (i: Img, x: number, y: number) => i.data[(y * i.width + x) * 4];
  assert.ok(Math.abs(at(back, 100, 8) - 60) < 12, 'the table stays dark');
  assert.ok(Math.abs(at(back, 100, 60) - 225) < 12, 'the paper stays light');
});

test('encoding works on a phone, where there is no Buffer, and leaves no stand-in behind', () => {
  const g = globalThis as { Buffer?: unknown };
  const real = g.Buffer;
  try {
    delete g.Buffer;
    assert.equal(typeof g.Buffer, 'undefined');
    const bytes = encodeJpeg(photo(64, 48, px([[4, 4], [60, 4], [60, 44], [4, 44]])));
    assert.equal(typeof g.Buffer, 'undefined', 'the stand-in is removed again');
    assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], 'a JPEG starts with FF D8');
    assert.equal(decodeJpeg(bytes).width, 64);
  } finally { g.Buffer = real; }
});

test('a real Buffer is left alone when there is one', () => {
  const before = (globalThis as { Buffer?: unknown }).Buffer;
  encodeJpeg(photo(32, 32, px([[2, 2], [30, 2], [30, 30], [2, 30]])));
  assert.equal((globalThis as { Buffer?: unknown }).Buffer, before);
});

test('a preview is a data URL of a JPEG', () => {
  const url = jpegDataUrl(photo(32, 32, px([[2, 2], [30, 2], [30, 30], [2, 30]])));
  assert.match(url, /^data:image\/jpeg;base64,\/9j\//);
});

test('bytes that are not a JPEG are refused with an error, not a crash', () => {
  assert.throws(() => decodeJpeg(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
});

test('a photo through the whole phone path: save, read, find the paper, scan it, save the scan', () => {
  // a tilted sheet, as held in a hand
  const sheet = px([[110, 30], [330, 70], [300, 370], [60, 320]]);
  const shot = decodeJpeg(encodeJpeg(photo(400, 400, sheet), 92));
  const found = findDocument(shot);
  assert.ok(found.confident, 'the paper is found despite the JPEG noise');
  found.quad.forEach((p, i) => assert.ok(Math.hypot(p.x - sheet[i].x / 400, p.y - sheet[i].y / 400) < 0.03, `corner ${i}`));
  const scan = scanImage(shot, found.quad, 'gray', 0);
  const out = decodeJpeg(encodeJpeg(scan, 90));
  assert.equal(out.width, scan.width); assert.equal(out.height, scan.height);
  assert.ok(out.width < 400 && out.height < 400 && out.width > 150 && out.height > 150, 'the table is cropped away');
  // what is left is paper with print on it: a strip of table would be a large dark area, the print is about an eighth
  let dark = 0;
  for (let i = 0; i < out.data.length; i += 4) if (out.data[i] < 100) dark++;
  const share = dark / (out.width * out.height);
  assert.ok(share > 0.03 && share < 0.25, `dark share ${share.toFixed(2)}`);
});
