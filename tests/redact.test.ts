import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countByReason, drawnBox, findSensitive, parseHideWords, pixelRects, removeDrawn, setReason, toggleBox, withNewSearch } from '../src/core/redact';
import type { OcrWord, PageWords, RedactBox } from '../src/core/redact';

// Pages are built the way text recognition reports them: words with pixel boxes on a 1224 x 1584 page.
const W = 1224, H = 1584, CH = 22, CW = 13;
const line = (y: number, text: string, x0 = 100): OcrWord[] => {
  const out: OcrWord[] = []; let x = x0;
  for (const t of text.split(' ')) { out.push({ text: t, box: [x, y, x + t.length * CW, y + CH] }); x += t.length * CW + 12; }
  return out;
};
const page = (...lines: OcrWord[][]): PageWords => ({ width: W, height: H, words: lines.flat() });
const covers = (b: RedactBox, w: OcrWord) => b.x * W < w.box[2] && (b.x + b.w) * W > w.box[0] && b.y * H < w.box[3] && (b.y + b.h) * H > w.box[1];
const reasons = (boxes: RedactBox[]) => boxes.map((b) => b.reason).sort();

test('a full account number is hidden but its last four digits stay, so the reader can still tell which account it is', () => {
  const p = page(line(300, 'Account Number 0123 4567 8901 2345'));
  const boxes = findSensitive([p]);
  assert.deepEqual(reasons(boxes), ['account', 'account', 'account']);
  const w = p.words;
  assert.ok(covers(boxes[0], w[2]) || boxes.some((b) => covers(b, w[2])));
  assert.ok(!boxes.some((b) => covers(b, w[5])), 'the last four digits are not covered');
  assert.ok(!boxes.some((b) => covers(b, w[0])), 'the label is not covered');
});

test('one long number loses everything but its last four digits', () => {
  const p = page(line(300, 'Account Number 123456789012'));
  const boxes = findSensitive([p]);
  assert.equal(boxes.length, 1);
  const w = p.words[2];
  assert.ok(boxes[0].x * W <= w.box[0] && (boxes[0].x + boxes[0].w) * W < w.box[0] + (w.box[2] - w.box[0]) * 0.8 + 20, 'the left 8 of 12 digits');
  assert.ok((boxes[0].x + boxes[0].w) * W < w.box[2] - 4 * CW + 6, 'the last four digits stay');
});

test('numbers in transaction rows, amounts, dates, masked numbers and ZIP+4 codes are left alone', () => {
  const p = page(
    line(700, '07/03 07/04 PAYPAL *BITESY 4029357733 CA 266.23'),
    line(730, 'New Balance Total $6,081.44 Reference Number 9413'),
    line(760, 'Account XXXX1234 ending ••••5678 Dallas'),
    line(790, 'Mail payment to: P.O. 75267-2050'),
  );
  assert.deepEqual(findSensitive([p]), []);
});

test('a long number in the header of the page is hidden even without a label, and so is any very long number', () => {
  assert.deepEqual(reasons(findSensitive([page(line(100, '0123456789'))])), ['account']);
  assert.deepEqual(reasons(findSensitive([page(line(900, '123456789012'))])), ['account']);
  assert.deepEqual(findSensitive([page(line(900, '0123456789'))]), []);
});

test('a social security number, an email address and a phone number are each hidden whole', () => {
  const b = findSensitive([page(line(300, 'SSN 123-45-6789'), line(340, 'write to me@example.com today'), line(380, 'Call 1.800.421.2110 now'), line(420, 'or (404) 555-0100'))]);
  assert.deepEqual(reasons(b), ['email', 'phone', 'phone', 'ssn']);
});

test('a name above a street address, the street line and the city line are found, and a neighbouring column is not touched', () => {
  const left = [line(400, 'JOHN Q PUBLIC'), line(424, '123 MAIN ST APT 4'), line(448, 'ATLANTA GA 30303')];
  const right = line(424, 'Statement Closing Date 07/10/2026', 800);
  const p = page(...left, right);
  const boxes = findSensitive([p]);
  assert.deepEqual(reasons(boxes), ['address', 'address', 'name']);
  for (const w of right) assert.ok(!boxes.some((b) => covers(b, w)), `${w.text} is in the other column`);
  assert.ok(boxes.some((b) => b.reason === 'name' && b.text === 'JOHN Q PUBLIC'));
});

test('a heading in capitals above an address is not mistaken for a name', () => {
  const boxes = findSensitive([page(line(400, 'CUSTOMER SERVICE INFORMATION'), line(424, '123 MAIN ST'))]);
  assert.deepEqual(reasons(boxes), ['address']);
});

test('the bank\'s own post office box and city line are found too, and can be switched off in the review', () => {
  const boxes = findSensitive([page(line(500, 'P.O. Box 672050'), line(524, 'Dallas TX 75267-2050'))]);
  assert.deepEqual(reasons(boxes), ['address', 'address']);
  assert.ok(boxes.every((b) => b.on));
});

test('words the person asked to hide are found as phrases, ignoring case and one slip of the recogniser', () => {
  const p = page(line(300, 'Paid by John Q Public on 07/03'), line(340, 'Pub1ic family trust'));
  const boxes = findSensitive([p], { hide: ['john q public', 'public'] });
  assert.ok(boxes.every((b) => b.reason === 'hidden_word'));
  assert.ok(boxes.some((b) => b.text === 'john q public'));
  assert.ok(boxes.some((b) => b.text === 'public' && covers(b, p.words[p.words.length - 3])), 'Pub1ic, read with one wrong character, is still found');
  assert.deepEqual(findSensitive([p]), []);
  assert.deepEqual(findSensitive([p], { hide: ['  ', ''] }), []);
});

test('boxes are fractions of the page, so they hold at any scale', () => {
  const [b] = findSensitive([page(line(300, 'SSN 123-45-6789'))]);
  for (const v of [b.x, b.y, b.w, b.h]) assert.ok(v >= 0 && v <= 1);
  const small = pixelRects([b], 0, W / 2, H / 2)[0], big = pixelRects([b], 0, W * 2, H * 2)[0];
  assert.ok(Math.abs(big.x - small.x * 4) <= 4 && Math.abs(big.w - small.w * 4) <= 8);
});

test('only switched-on boxes are burned in, drawn boxes are added, and the summary counts both', () => {
  const found = findSensitive([page(line(300, 'SSN 123-45-6789'), line(340, 'write to me@example.com'))]);
  const drawn = drawnBox(0, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 }, 0);
  assert.deepEqual([drawn.x, drawn.y, drawn.reason], [0.2, 0.3, 'drawn']);
  assert.ok(Math.abs(drawn.w - 0.3) < 1e-9 && Math.abs(drawn.h - 0.2) < 1e-9);
  const all = [...found.map((b, i) => (i === 0 ? { ...b, on: false } : b)), drawn];
  assert.equal(pixelRects(all, 0, W, H).length, 2, 'one found box was switched off');
  assert.equal(pixelRects(all, 1, W, H).length, 0, 'other pages are not touched');
  assert.deepEqual(countByReason(all).map((c) => [c.reason, c.on, c.total]).sort(), [['drawn', 1, 1], ['email', 1, 1], ['ssn', 0, 1]].sort());
});

test('an empty page or no pages find nothing', () => {
  assert.deepEqual(findSensitive([]), []);
  assert.deepEqual(findSensitive([{ width: W, height: H, words: [] }]), []);
});


test('boxes are switched one at a time or a whole kind at once, and only a drawn box can be removed', () => {
  const found = findSensitive([page(line(400, 'JOHN Q PUBLIC'), line(424, '123 MAIN ST'), line(448, 'ATLANTA GA 30303'), line(500, 'SSN 123-45-6789'))]);
  const drawn = drawnBox(0, { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, 0);
  const all = [...found, drawn];
  const one = toggleBox(all, found[0].id);
  assert.equal(one.filter((b) => !b.on).length, 1);
  assert.equal(setReason(all, 'address', false).filter((b) => !b.on).length, 2);
  assert.equal(setReason(setReason(all, 'address', false), 'address', true).filter((b) => !b.on).length, 0);
  assert.equal(removeDrawn(all, found[0].id).length, all.length, 'a found box stays: it is switched off instead');
  assert.equal(removeDrawn(all, drawn.id).length, all.length - 1);
});

test('searching again keeps what the person drew and what they switched off', () => {
  const p = page(line(400, '123 MAIN ST'), line(424, 'Paid by John Q Public'));
  const first = findSensitive([p]);
  const drawn = drawnBox(0, { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }, 0);
  const current = [...toggleBox(first, first[0].id), drawn];
  const again = withNewSearch(current, findSensitive([p], { hide: ['john q public'] }));
  assert.ok(again.some((b) => b.reason === 'drawn'), 'the drawn box stays');
  assert.ok(again.some((b) => b.reason === 'hidden_word' && b.on), 'the new word is found');
  assert.equal(again.find((b) => b.reason === 'address')!.on, false, 'the address the person switched off stays off');
});

test('words to hide are read from a typed list', () => {
  assert.deepEqual(parseHideWords('John Q Public, 123 Main St\nAcme Corp;; john q public ,'), ['John Q Public', '123 Main St', 'Acme Corp', 'john q public']);
  assert.deepEqual(parseHideWords('  ,\n '), []);
});
