import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FULL_FRAME, enhance, findDocument, gray, isValidQuad, moveCorner, nearestCorner, otsu, outputSize, rotate, scanImage, warpQuad } from '../src/core/scan';
import type { Img, Pt, Quad } from '../src/core/scan';

/** A picture of a sheet on a darker surface: `quad` is the sheet in pixels, `light(x, y)` how bright the paper is there, `ink` marks dark print. */
function photo(w: number, h: number, quad: Quad, opts: { table?: number; light?: (x: number, y: number) => number; ink?: (x: number, y: number) => boolean } = {}): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) { const s = Math.sign(c); if (sign && s !== sign) return false; sign = s; }
    }
    return true;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    let v = opts.table ?? 60;
    if (inside(x, y)) v = opts.ink?.(x, y) ? 40 : (opts.light?.(x, y) ?? 225);
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
const px = (xs: [number, number][]): Quad => xs.map(([x, y]) => ({ x, y })) as Quad;
const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const lines = (x: number, y: number) => y % 18 < 3 && x % 40 < 28;

test('an upright sheet on a darker surface is found, with its four corners', () => {
  const sheet = px([[80, 40], [320, 40], [320, 360], [80, 360]]);
  const s = findDocument(photo(400, 400, sheet, { ink: lines }));
  assert.ok(s.confident);
  const want: Pt[] = sheet.map((p) => ({ x: p.x / 400, y: p.y / 400 }));
  s.quad.forEach((p, i) => assert.ok(near(p, want[i], 0.02), `corner ${i}: ${JSON.stringify(p)} vs ${JSON.stringify(want[i])}`));
});

test('a tilted sheet seen at an angle is found too', () => {
  const sheet = px([[110, 30], [330, 70], [300, 370], [60, 320]]);
  const s = findDocument(photo(400, 400, sheet, { ink: lines }));
  assert.ok(s.confident);
  s.quad.forEach((p, i) => assert.ok(near(p, { x: sheet[i].x / 400, y: sheet[i].y / 400 }, 0.03), `corner ${i}`));
  assert.ok(isValidQuad(s.quad));
});

test('with no clear sheet the whole photo is suggested, and it says it is not sure', () => {
  const flat = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(150) };
  for (const img of [flat, photo(200, 200, px([[0, 0], [200, 0], [200, 200], [0, 200]]))]) {
    const s = findDocument(img);
    assert.equal(s.confident, false);
    assert.deepEqual(s.quad, FULL_FRAME);
  }
  assert.notEqual(findDocument(flat).quad, FULL_FRAME, 'a copy, so editing it cannot change the constant');
});

test('a crop must be convex, inside the picture and big enough', () => {
  assert.ok(isValidQuad(FULL_FRAME));
  assert.ok(!isValidQuad(px([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [x, y]) as [number, number][])), 'crossed corners');
  assert.ok(!isValidQuad([{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.51, y: 0.51 }, { x: 0.5, y: 0.51 }]), 'too small');
  assert.ok(!isValidQuad([{ x: -0.1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), 'outside the picture');
  assert.ok(!isValidQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.3 }, { x: 0, y: 1 }]), 'not convex');
});

test('cutting out a tilted sheet gives an upright rectangle of the sheet and nothing else', () => {
  const pts = px([[110, 30], [330, 70], [300, 370], [60, 320]]);
  const img = photo(400, 400, pts);
  const q = pts.map((p) => ({ x: p.x / 400, y: p.y / 400 })) as Quad;
  const size = outputSize(q, 400, 400);
  const out = warpQuad(img, q, size.width, size.height);
  assert.ok(size.width > 200 && size.height > 280);
  // away from the very edge, every pixel is paper (225), never the darker surface (60) next to the sheet or a blend of the two
  let table = 0, n = 0;
  for (let y = 4; y < out.height - 4; y++) for (let x = 4; x < out.width - 4; x++) { n++; const v = out.data[(y * out.width + x) * 4]; if (v > 50 && v < 100) table++; }
  assert.ok(table / n < 0.01, `surface or edge blend in ${((table / n) * 100).toFixed(1)}% of the cut-out`);
});

test('the size follows the sheet and never exceeds the limit', () => {
  const s = outputSize(FULL_FRAME, 3000, 4000, 2400);
  assert.equal(Math.max(s.width, s.height), 2400);
  assert.ok(Math.abs(s.width / s.height - 0.75) < 0.01);
  assert.deepEqual(outputSize(FULL_FRAME, 300, 200), { width: 300, height: 200 });
});

test('uneven light is flattened: the paper turns white and the print stays dark', () => {
  // a shadow runs from bright on the left to dim on the right
  const shade = (x: number) => 235 - (x / 400) * 110;
  const img = photo(400, 300, FULL_FRAME.map((p) => ({ x: p.x * 399, y: p.y * 299 })) as Quad, { light: (x) => shade(x), ink: (x, y) => lines(x, y) });
  const before = gray(img);
  const out = enhance(img, 'gray');
  const o = gray(out);
  let paperMin = 255, inkMax = 0;
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
    const i = y * 400 + x;
    if (lines(x, y)) { if (x > 4 && x < 396 && y > 4 && y < 296) inkMax = Math.max(inkMax, o[i]); }
    else if (x > 4 && x < 396 && y > 4 && y < 296 && !(y % 18 < 6 && x % 40 < 31)) paperMin = Math.min(paperMin, o[i]);
  }
  assert.ok(before[299 * 400 + 390] < 150, 'the test picture really has a dim side');
  assert.ok(paperMin >= 235, `paper reaches only ${paperMin}`);
  assert.ok(inkMax <= 120, `print is as light as ${inkMax}`);
  // gray output has equal channels, 'original' returns the picture itself
  assert.ok(out.data[0] === out.data[1] && out.data[1] === out.data[2]);
  assert.equal(enhance(img, 'original'), img);
});

test('colour mode keeps colours while evening out the light', () => {
  const w = 120, h = 90;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 220; data[i * 4 + 1] = 140; data[i * 4 + 2] = 120; data[i * 4 + 3] = 255; }
  const out = enhance({ width: w, height: h, data }, 'color');
  const o = (60 * w + 60) * 4;
  assert.ok(out.data[o] >= out.data[o + 1] && out.data[o + 1] >= out.data[o + 2], 'red stays strongest');
  assert.ok(out.data[o] > 230, 'a uniformly lit sheet becomes bright');
});

test('turning by quarter turns moves pixels as a clockwise rotation would', () => {
  const data = new Uint8ClampedArray(3 * 2 * 4);
  for (let i = 0; i < 6; i++) { data[i * 4] = i * 10; data[i * 4 + 1] = i * 10; data[i * 4 + 2] = i * 10; data[i * 4 + 3] = 255; }
  const img = { width: 3, height: 2, data };         // row 0: 0 10 20, row 1: 30 40 50
  const r = rotate(img, 1);
  assert.deepEqual([r.width, r.height], [2, 3]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => r.data[i * 4]), [30, 0, 40, 10, 50, 20]);
  assert.deepEqual([...rotate(img, 2).data].filter((_, i) => i % 4 === 0), [50, 40, 30, 20, 10, 0]);
  assert.deepEqual([...rotate(rotate(img, 1), 3).data], [...img.data], 'a turn and its way back');
  assert.equal(rotate(img, 4), img);
});

test('scanImage runs the whole path and honours the size limit and the turn', () => {
  const sheet = px([[80, 40], [320, 40], [320, 360], [80, 360]]);
  const img = photo(400, 400, sheet, { ink: lines });
  const s = findDocument(img);
  const a = scanImage(img, s.quad, 'gray');
  assert.ok(a.height > a.width, 'a tall sheet gives a tall scan');
  const b = scanImage(img, s.quad, 'gray', 1);
  assert.deepEqual([b.width, b.height], [a.height, a.width]);
  const c = scanImage(img, s.quad, 'gray', 0, 100);
  assert.ok(Math.max(c.width, c.height) <= 100);
});

test('corners are moved inside the picture and picked by closeness, scaled for the shape of the picture', () => {
  const moved = moveCorner(FULL_FRAME, 2, { x: 1.4, y: 0.7 });
  assert.deepEqual(moved[2], { x: 1, y: 0.7 });
  assert.deepEqual(FULL_FRAME[2], { x: 1, y: 1 }, 'the original is untouched');
  assert.equal(nearestCorner(FULL_FRAME, { x: 0.97, y: 0.04 }), 1);
  assert.equal(nearestCorner(FULL_FRAME, { x: 0.5, y: 0.5 }), -1);
  // on a wide picture a step down the page is a shorter distance than the same step across; on a tall one it is longer
  assert.equal(nearestCorner(FULL_FRAME, { x: 0, y: 0.12 }, 2), 0);
  assert.equal(nearestCorner(FULL_FRAME, { x: 0, y: 0.12 }, 0.5), -1);
});

test('the best split between dark and light sits between them', () => {
  const v = new Uint8Array(1000); for (let i = 0; i < 1000; i++) v[i] = i < 400 ? 50 : 200;
  const t = otsu(v);
  assert.ok(t >= 50 && t < 200);
});
