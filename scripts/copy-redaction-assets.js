// Copies the files the in-app redaction needs into public/redact/, so the app serves them itself and never fetches them from a CDN:
// the PDF page renderer and its worker, the OCR engine and its worker, the PDF writer, its WebAssembly cores, and the English recognition data.
// Runs after install and before start. The copies are git-ignored (public/redact/); delete the folder and run this again to rebuild it.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = path.join(root, 'public', 'redact');

const files = [
  // the libraries themselves are loaded at run time from here (not bundled), so a CDN is never involved
  [nm('pdfjs-dist', 'build', 'pdf.min.mjs'), 'pdf.min.mjs'],
  [nm('tesseract.js', 'dist', 'tesseract.min.js'), 'tesseract.min.js'],
  [nm('pdf-lib', 'dist', 'pdf-lib.min.js'), 'pdf-lib.min.js'],
  [nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), 'pdf.worker.min.mjs'],
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  // the engine picks the fastest core the browser can run, so all three LSTM cores are shipped
  [nm('tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

if (!files.every(([from]) => fs.existsSync(from))) {
  // dependencies not installed yet (or a partial install): nothing to copy, and nothing in the app needs it until a statement is redacted
  console.log('copy-redaction-assets: some packages are not installed yet, skipping.');
  process.exit(0);
}
fs.mkdirSync(out, { recursive: true });
let copied = 0;
for (const [from, name] of files) {
  const to = path.join(out, name);
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
  fs.copyFileSync(from, to);
  copied++;
}
console.log(`copy-redaction-assets: ${copied ? `copied ${copied} file${copied > 1 ? 's' : ''}` : 'already up to date'} (public/redact)`);
