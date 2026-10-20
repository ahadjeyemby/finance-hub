// The redaction engine, for the web version. Everything runs in the browser and from files this app serves itself:
//   - pdf.js (public/redact/pdf.min.mjs) draws each page of a PDF onto a canvas,
//   - Tesseract (public/redact/tesseract.min.js, its worker, cores and English data) reads the text and says where it is,
//   - core/redact.ts decides which of it looks sensitive,
//   - pdf-lib (public/redact/pdf-lib.min.js) writes the redacted pages into a new PDF.
// No model and no outside service is involved, and no file is fetched from a CDN. The redacted pages are flattened pictures: the black boxes are
// pixels, so there is no hidden text underneath to recover.
import { findSensitive, pixelRects } from '@/core/redact';
import type { OcrWord, PageWords, RedactBox } from '@/core/redact';
import type { Scan } from './redact';

export const redactionSupported = true;

/** Pages are drawn at this many pixels per PDF point: sharp enough for the reader to read digits, small enough to keep. */
const SCALE = 2.5;
const MAX_SIDE = 3400;
const QUALITY = 0.92;

const base = () => new URL('redact/', document.baseURI).href;

const scripts = new Map<string, Promise<void>>();
function loadScript(name: string): Promise<void> {
  if (!scripts.has(name)) {
    scripts.set(name, new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = base() + name; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { scripts.delete(name); reject(new Error(`Could not load ${name}. Run "bun run web" once so the redaction files are copied (scripts/copy-redaction-assets.js).`)); };
      document.head.appendChild(el);
    }));
  }
  return scripts.get(name)!;
}

// the PDF renderer is a module; it is loaded by address so the bundler never tries to pack it
type PdfJs = { getDocument: (o: unknown) => { promise: Promise<any> }; GlobalWorkerOptions: { workerSrc: string } };
let pdfjsPromise: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (new Function('u', 'return import(u)') as (u: string) => Promise<PdfJs>)(base() + 'pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.mjs'; return m; });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

async function ocrWorker(): Promise<any> {
  await loadScript('tesseract.min.js');
  const T = (window as any).Tesseract;
  return T.createWorker('eng', 1, { workerPath: base() + 'worker.min.js', corePath: base(), langPath: base(), workerBlobURL: false, cacheMethod: 'none', gzip: true });
}

const newCanvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const preview = (c: HTMLCanvasElement) => {
  const k = Math.min(1, 900 / c.width);
  const p = newCanvas(Math.round(c.width * k), Math.round(c.height * k));
  p.getContext('2d')!.drawImage(c, 0, 0, p.width, p.height);
  return p.toDataURL('image/jpeg', 0.75);
};

/** Draw every page of the file onto a canvas: PDF pages through pdf.js, a photo as one page. `points` is each page's size in PDF points. */
async function drawPages(bytes: Uint8Array, type: string): Promise<{ canvas: HTMLCanvasElement; points: [number, number] }[]> {
  if (type === 'application/pdf') {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: bytes.slice() }).promise;     // a copy: the renderer takes ownership of what it is given
    const out: { canvas: HTMLCanvasElement; points: [number, number] }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const k = Math.min(SCALE, MAX_SIDE / Math.max(unit.width, unit.height));
      const vp = page.getViewport({ scale: k });
      const canvas = newCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      // the "print" intent draws in one go; the on-screen intent waits for animation frames, which a background tab never gets
      await page.render({ canvas, viewport: vp, intent: 'print' }).promise;
      out.push({ canvas, points: [unit.width, unit.height] });
    }
    return out;
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = newCanvas(Math.round(bitmap.width * k), Math.round(bitmap.height * k));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return [{ canvas, points: [canvas.width, canvas.height] }];
}

type Held = { canvas: HTMLCanvasElement; points: [number, number] };

export async function scanForRedaction(bytes: Uint8Array, type: string, hide: string[], onProgress: (message: string) => void = () => {}): Promise<Scan> {
  onProgress('Preparing the text reader');
  const worker = await ocrWorker();
  try {
    onProgress('Drawing the pages');
    const held: Held[] = await drawPages(bytes, type);
    const pagesWords: PageWords[] = [];
    for (let i = 0; i < held.length; i++) {
      onProgress(`Reading page ${i + 1} of ${held.length}`);
      const res = await worker.recognize(held[i].canvas, {}, { blocks: true });
      const words: OcrWord[] = [];
      for (const b of res.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ text: w.text, conf: w.confidence, box: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] });
      pagesWords.push({ width: held[i].canvas.width, height: held[i].canvas.height, words });
    }
    onProgress('Looking for sensitive details');
    return {
      pages: held.map((h) => ({ width: h.canvas.width, height: h.canvas.height, preview: preview(h.canvas) })),
      boxes: findSensitive(pagesWords, { hide }),
      words: pagesWords,
      pageImages: held,
    };
  } finally {
    await worker.terminate();
  }
}

export async function burnRedactions(scan: Scan, boxes: RedactBox[], wasPdf: boolean): Promise<{ bytes: Uint8Array; type: string }> {
  const held = (scan.pageImages ?? []) as Held[];
  if (!held.length) throw new Error('The pages are no longer held in memory. Scan the file again.');
  const jpegs: Uint8Array[] = [];
  for (let i = 0; i < held.length; i++) {
    const src = held[i].canvas;
    const out = newCanvas(src.width, src.height);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    ctx.fillStyle = '#000';
    for (const r of pixelRects(boxes, i, out.width, out.height)) ctx.fillRect(r.x, r.y, r.w, r.h);
    const blob: Blob = await new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not write the page image.'))), 'image/jpeg', QUALITY));
    jpegs.push(new Uint8Array(await blob.arrayBuffer()));
  }
  if (!wasPdf) return { bytes: jpegs[0], type: 'image/jpeg' };
  await loadScript('pdf-lib.min.js');
  const { PDFDocument } = (window as any).PDFLib;
  const doc = await PDFDocument.create();
  for (let i = 0; i < jpegs.length; i++) {
    const image = await doc.embedJpg(jpegs[i]);
    const [w, h] = held[i].points;
    const page = doc.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return { bytes: new Uint8Array(await doc.save()), type: 'application/pdf' };
}

export function discardScan(scan: Scan): void {
  for (const h of (scan.pageImages ?? []) as Held[]) { h.canvas.width = 0; h.canvas.height = 0; }
  scan.pageImages = undefined;
  scan.words = [];
}
