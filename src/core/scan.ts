// Document scanning for photos of receipts: find the paper, cut it out flat, and clean it up so the text reads well. Pure TypeScript on pixel
// arrays (RGBA, as a canvas gives them): no React, no network, no model. The platform layer (data/scan.web.ts) decodes and encodes the pictures.
//
// Three steps, each usable alone:
//   1. findDocument  suggests the four corners of the paper (always only a suggestion: the person can move every corner),
//   2. warpQuad      cuts the quadrilateral out and straightens it, which also corrects the tilt of a photo taken at an angle,
//   3. enhance       evens out the lighting, whitens the paper and darkens the print, in grayscale unless colour is asked for.

export interface Img { width: number; height: number; data: Uint8ClampedArray }
/** a point as a fraction of the picture: 0 is the left or top edge, 1 the right or bottom */
export interface Pt { x: number; y: number }
/** corners in the order top-left, top-right, bottom-right, bottom-left */
export type Quad = [Pt, Pt, Pt, Pt];
export type ScanMode = 'gray' | 'color' | 'original';

export const FULL_FRAME: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Grayscale, resizing
// ---------------------------------------------------------------------------
/** Luminance 0..255 for every pixel (Rec. 601 weights). */
export function gray(img: Img): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000;
  return out;
}

/** A smaller grayscale copy (each new pixel is the mean of the block it covers), longest side at most `maxSide`. */
export function smallGray(img: Img, maxSide: number): { width: number; height: number; px: Uint8Array } {
  const g = gray(img);
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  if (k === 1) return { width: w, height: h, px: g };
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += g[yy * img.width + xx]; n++; }
      px[y * w + x] = s / n;
    }
  }
  return { width: w, height: h, px };
}

/** The threshold that best separates dark from light pixels (Otsu's method). */
export function otsu(px: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of px) hist[v]++;
  const total = px.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Finding the paper
// ---------------------------------------------------------------------------
const SEARCH_SIDE = 320;

/** The largest group of touching pixels where `mask` is set (4-neighbour), as pixel indices. */
function largestRegion(mask: Uint8Array, w: number, h: number): number[] {
  const seen = new Uint8Array(mask.length);
  let best: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const region: number[] = [];
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!; region.push(i);
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (region.length > best.length) best = region;
  }
  return best;
}

const quadArea = (q: Quad) => {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; }
  return Math.abs(a) / 2;
};
const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** A usable crop: four corners that turn the same way (convex), inside the picture and covering a worthwhile part of it. */
export function isValidQuad(q: Quad, minArea = 0.02): boolean {
  if (q.some((p) => !(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1))) return false;
  const signs = [0, 1, 2, 3].map((i) => Math.sign(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])));
  return signs.every((s) => s !== 0 && s === signs[0]) && quadArea(q) >= minArea;
}

export interface Suggestion { quad: Quad; /** false when no clear sheet of paper was found, so the whole photo is suggested */ confident: boolean }

/**
 * Suggest where the paper is. A receipt is lighter than what it lies on, so the pixels brighter than the best light/dark split are grouped, the
 * largest group is taken to be the paper, and its four extreme corners (top-left, top-right, and so on) are the crop. This handles a tilted sheet
 * or one seen at an angle. When the paper does not stand out (a white table), or it fills the frame, the whole photo is suggested instead.
 */
export function findDocument(img: Img): Suggestion {
  const none: Suggestion = { quad: FULL_FRAME.map((p) => ({ ...p })) as Quad, confident: false };
  const { width: w, height: h, px } = smallGray(img, SEARCH_SIDE);
  if (w < 8 || h < 8) return none;
  const t = otsu(px);
  const mask = new Uint8Array(px.length);
  let bright = 0;
  for (let i = 0; i < px.length; i++) if (px[i] > t) { mask[i] = 1; bright++; }
  // a flat picture has nothing to separate; a mostly bright one is paper on paper, or paper filling the frame
  if (bright < px.length * 0.1 || bright > px.length * 0.97) return none;
  const region = largestRegion(mask, w, h);
  if (region.length < px.length * 0.12 || region.length > px.length * 0.97) return none;

  let tl = Infinity, br = -Infinity, tr = -Infinity, bl = Infinity;
  let pTL = 0, pBR = 0, pTR = 0, pBL = 0;
  for (const i of region) {
    const x = i % w, y = (i / w) | 0;
    const s = x + y, d = x - y;
    if (s < tl) { tl = s; pTL = i; } if (s > br) { br = s; pBR = i; }
    if (d > tr) { tr = d; pTR = i; } if (d < bl) { bl = d; pBL = i; }
  }
  const at = (i: number): Pt => ({ x: ((i % w) + 0.5) / w, y: (((i / w) | 0) + 0.5) / h });
  // push the corners out by about a pixel of the search picture so the paper's own edge is not clipped
  const raw: Quad = [at(pTL), at(pTR), at(pBR), at(pBL)];
  const cx = raw.reduce((s, p) => s + p.x, 0) / 4, cy = raw.reduce((s, p) => s + p.y, 0) / 4;
  const quad = raw.map((p) => {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
    return { x: clamp(p.x + (dx / len) * (1 / w), 0, 1), y: clamp(p.y + (dy / len) * (1 / h), 0, 1) };
  }) as Quad;
  // the group should fill most of its quadrilateral; a ragged shape means the guess is not trustworthy
  const fill = region.length / (w * h) / quadArea(quad);
  if (!isValidQuad(quad, 0.1) || fill < 0.7 || fill > 1.1) return none;
  return { quad, confident: true };
}

// ---------------------------------------------------------------------------
// Cutting out and straightening
// ---------------------------------------------------------------------------
/** Size of the straightened picture: the longer of each pair of opposite sides, in pixels of the source, shrunk to fit `maxSide`. */
export function outputSize(q: Quad, srcW: number, srcH: number, maxSide = 2400): { width: number; height: number } {
  const len = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * srcW, (a.y - b.y) * srcH);
  let w = Math.max(len(q[0], q[1]), len(q[3], q[2])), h = Math.max(len(q[0], q[3]), len(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(w, h, 1));
  w *= k; h *= k;
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/** Cut the quadrilateral out of the picture and stretch it to a rectangle (a perspective warp, sampled smoothly). */
export function warpQuad(src: Img, q: Quad, width: number, height: number): Img {
  const P = q.map((p) => ({ x: p.x * src.width, y: p.y * src.height }));
  const [p0, p1, p2, p3] = P;
  // the mapping from the unit square onto the quadrilateral (square-to-quad homography)
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, hh = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if ((dx3 !== 0 || dy3 !== 0) && Math.abs(den) > 1e-9) { g = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dx3 * dy1) / den; }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + hh * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + hh * p3.y, f = p0.y;

  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width, sh = src.height, sd = src.data;
  for (let y = 0; y < height; y++) {
    const v = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const u = width > 1 ? x / (width - 1) : 0;
      const wgt = g * u + hh * v + 1;
      const sx = clamp((a * u + b * v + c) / wgt, 0, sw - 1), sy = clamp((d * u + e * v + f) / wgt, 0, sh - 1);
      const x0 = sx | 0, y0 = sy | 0, x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        out[o + ch] = (sd[i00 + ch] * (1 - fx) + sd[i10 + ch] * fx) * (1 - fy) + (sd[i01 + ch] * (1 - fx) + sd[i11 + ch] * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Turn the picture by quarter turns clockwise (0 to 3). */
export function rotate(img: Img, quarterTurns: number): Img {
  const n = ((quarterTurns % 4) + 4) % 4;
  if (!n) return img;
  const w = img.width, h = img.height;
  const ow = n === 2 ? w : h, oh = n === 2 ? h : w;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [nx, ny] = n === 1 ? [h - 1 - y, x] : n === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const s = (y * w + x) * 4, o = (ny * ow + nx) * 4;
      out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = 255;
    }
  }
  return { width: ow, height: oh, data: out };
}

// ---------------------------------------------------------------------------
// Cleaning up
// ---------------------------------------------------------------------------
const BLOCK = 12;      // the lighting is estimated on blocks this many pixels wide, then smoothed

/**
 * How bright the paper is around each block of the picture. Print is thin and dark, so the brightest pixels of a block stand for the paper;
 * a wide smoothing then removes the print and the grain and leaves the shadows and light gradients.
 */
function paperLevel(g: Uint8Array, w: number, h: number): { gw: number; gh: number; level: Float32Array } {
  const gw = Math.max(1, Math.ceil(w / BLOCK)), gh = Math.max(1, Math.ceil(h / BLOCK));
  const hi = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      const vals: number[] = [];
      for (let y = by * BLOCK; y < Math.min(h, (by + 1) * BLOCK); y++) for (let x = bx * BLOCK; x < Math.min(w, (bx + 1) * BLOCK); x++) vals.push(g[y * w + x]);
      vals.sort((p, q) => p - q);
      hi[by * gw + bx] = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
    }
  }
  // widen the bright blocks over their neighbours (so a block of solid print takes the paper level around it), then blur
  const grow = (src: Float32Array, r: number, pick: (a: number, b: number) => number, mean = false) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let acc = mean ? 0 : src[y * gw + x], n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        acc = mean ? acc + src[yy * gw + xx] : pick(acc, src[yy * gw + xx]); n++;
      }
      out[y * gw + x] = mean ? acc / n : acc;
    }
    return out;
  };
  const level = grow(grow(hi, 2, Math.max), 2, Math.max, true);
  return { gw, gh, level };
}

/**
 * Even out the lighting and sharpen the contrast: every pixel is divided by the brightness of the paper around it, so shadows and a bright
 * corner disappear and the paper becomes white, then the dark end is stretched so faint print gets darker. 'gray' returns a grayscale scan,
 * 'color' keeps the colours with the same correction, 'original' returns the picture untouched.
 */
export function enhance(img: Img, mode: ScanMode): Img {
  if (mode === 'original') return img;
  const { width: w, height: h } = img;
  const g = gray(img);
  const { gw, gh, level } = paperLevel(g, w, h);
  const gain = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = clamp(y / BLOCK - 0.5, 0, gh - 1), y0 = fy | 0, y1 = Math.min(y0 + 1, gh - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp(x / BLOCK - 0.5, 0, gw - 1), x0 = fx | 0, x1 = Math.min(x0 + 1, gw - 1), tx = fx - x0;
      const bg = (level[y0 * gw + x0] * (1 - tx) + level[y0 * gw + x1] * tx) * (1 - ty) + (level[y1 * gw + x0] * (1 - tx) + level[y1 * gw + x1] * tx) * ty;
      gain[y * w + x] = 255 / Math.max(bg, 40);     // a very dark patch is not stretched without limit
    }
  }
  // the dark end: the 1st percentile of the evened-out picture becomes black, 245 and above becomes white
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[clamp(Math.round(g[i] * gain[i]))]++;
  let acc = 0, low = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= g.length * 0.01) { low = v; break; } }
  low = Math.min(low, 150);
  const high = 245;
  const map = (v: number) => clamp(((v - low) / (high - low)) * 255);

  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (mode === 'gray') {
      const v = map(g[i] * gain[i]);
      out[p] = out[p + 1] = out[p + 2] = v;
    } else {
      const k = map(g[i] * gain[i]) / Math.max(1, g[i] * gain[i]);
      out[p] = clamp(img.data[p] * gain[i] * k); out[p + 1] = clamp(img.data[p + 1] * gain[i] * k); out[p + 2] = clamp(img.data[p + 2] * gain[i] * k);
    }
    out[p + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

/** Everything in one go: cut out the quadrilateral, turn it, clean it up. `maxSide` limits the size of the result. */
export function scanImage(src: Img, quad: Quad, mode: ScanMode, quarterTurns = 0, maxSide = 2400): Img {
  const size = outputSize(quad, src.width, src.height, maxSide);
  return enhance(rotate(warpQuad(src, quad, size.width, size.height), quarterTurns), mode);
}

/** Move one corner, keeping it inside the picture. */
export function moveCorner(q: Quad, index: number, to: Pt): Quad {
  const next = q.map((p) => ({ ...p })) as Quad;
  next[index] = { x: clamp(to.x, 0, 1), y: clamp(to.y, 0, 1) };
  return next;
}

/** The corner nearest to a point, if it is within `radius` of the picture width. `aspect` is width over height, so a distance counts the same up and across. */
export function nearestCorner(q: Quad, at: Pt, aspect = 1, radius = 0.08): number {
  let best = -1, bestD = radius;
  q.forEach((p, i) => { const d = Math.hypot((p.x - at.x), (p.y - at.y) / aspect); if (d <= bestD) { best = i; bestD = d; } });
  return best;
}
