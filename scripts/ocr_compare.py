#!/usr/bin/env python3
"""Compare how OpenRouter models read one receipt photo. A test only: nothing in the app uses this file.

    export OPENROUTER_API_KEY=...        # your key, from the environment, or as a line in the project's git-ignored .env
    python3 scripts/ocr_compare.py                       # June-July-1.jpg, both models, 3 runs each
    python3 scripts/ocr_compare.py IMAGE --runs 5 --models anthropic/claude-haiku-5.5 scaledown/extract

Each model gets the same image and the same instructions. The answer is scored against the receipt as printed
(GROUND_TRUTH below, read by eye from June-July-1.jpg: seven items, subtotal 74.62, tax 4.48, total 79.10).
Requests ask OpenRouter to route only to providers that do not store or train on prompts, like the app does.
Standard library only.
"""
import argparse, base64, json, mimetypes, os, re, statistics, sys, time, urllib.error, urllib.request

DEFAULT_IMAGE = os.path.expanduser('~/Desktop/Audit-2026/Receipt/June-July/June-July-1.jpg')
DEFAULT_MODELS = ['anthropic/claude-haiku-5.5', 'scaledown/extract']

# What the receipt prints. Each item: words that identify it on the receipt, and its price in cents.
GROUND_TRUTH = {
    'subtotal': 7462, 'tax': 448, 'total': 7910, 'item_count': 7,
    'items': [
        ('TB SS TEE', ('tee',), 499),
        ('3PC SSET JRSY MIN LOGO', ('sset', 'jrsy'), 999),
        ('RAZOR 13 REFILL', ('razor',), 599),
        ('2PK GINGHAM BLUEBERRY', ('gingham',), 169),
        ('3 SECT 44OZ W UTEN', ('sect', 'uten'), 799),
        ('HYBRID CAS VULC BTTM', ('hybrid', 'vulc'), 2499),
        ('SANDALS SPEEDYMSHOE6', ('sandal', 'speedy'), 1898),
    ],
}

PROMPT = (
    'Read this receipt. Reply with ONE JSON object and nothing else, in this shape: '
    '{"merchant": str, "date": "YYYY-MM-DD", "items": [{"item": str, "price": number}], "subtotal": number, "tax": number, "total": number, "item_count": number|null}. '
    'One entry per item bought, prices in dollars exactly as printed. Many receipts print each item over two rows: a description row, then the row directly '
    'BELOW it with the SKU, quantity, price and amount. A price belongs to the description above its row, never the one below. '
    'item_count is the count the receipt prints (for example "SOLD ITEM COUNT = 7"), or null. Leave out nothing that is printed and add nothing that is not.'
)


def key_from_dotenv():
    """OPENROUTER_API_KEY from the project's .env (git-ignored), only that one line. None if it is not there."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
    try:
        with open(path) as f:
            for line in f:
                m = re.match(r'\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*?)\s*$', line)
                if m:
                    return m.group(1).strip('"\'') or None
    except OSError:
        pass
    return None


def cents(v):
    try:
        return round(float(v) * 100)
    except (TypeError, ValueError):
        return None


def call(model, image_path, key, timeout):
    mime = mimetypes.guess_type(image_path)[0] or 'image/jpeg'
    with open(image_path, 'rb') as f:
        url = f'data:{mime};base64,' + base64.b64encode(f.read()).decode()
    body = {
        'model': model,
        'temperature': 0,
        'max_tokens': 3000,
        'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': PROMPT}, {'type': 'image_url', 'image_url': {'url': url}}]}],
        'provider': {'data_collection': 'deny'},
        'usage': {'include': True},
    }
    if model.startswith('scaledown/'):
        # an extraction model, not a chat model: it wants the fields to pull out, as {name: description}, under provider.options.scaledown
        body['provider']['options'] = {'scaledown': {'entities': {
            'merchant': 'store name', 'date': 'purchase date as YYYY-MM-DD',
            'items': 'every item bought as a list of {item, price}; price in dollars; an item printed over two rows is one item and its price is on the row below its description',
            'subtotal': 'printed subtotal in dollars', 'tax': 'printed tax in dollars', 'total': 'printed total in dollars', 'item_count': 'the printed count of items sold, e.g. SOLD ITEM COUNT = 7'}}}
    req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'X-Title': 'Audit OCR comparison'})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:400]
        return {'error': f'HTTP {e.code}: {detail}', 'seconds': time.time() - t0}
    except Exception as e:  # network, timeout
        return {'error': f'{type(e).__name__}: {e}', 'seconds': time.time() - t0}
    secs = time.time() - t0
    msg = (data.get('choices') or [{}])[0].get('message') or {}
    text = msg.get('content') or ''
    if isinstance(text, list):
        text = ''.join(p.get('text', '') for p in text if isinstance(p, dict))
    usage = data.get('usage') or {}
    return {'text': text, 'seconds': secs, 'served_by': data.get('model'), 'cost': usage.get('cost'), 'tokens': usage.get('total_tokens'), 'error': (data.get('error') or {}).get('message')}


def parse(text):
    """The first JSON object in the reply, however it is wrapped. None if there is none."""
    t = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.M).strip()
    for start in [m.start() for m in re.finditer(r'\{', t)][:5]:
        depth = 0
        for i in range(start, len(t)):
            depth += t[i] == '{'
            depth -= t[i] == '}'
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except json.JSONDecodeError:
                    break
    return None


def score(obj):
    """Compare one parsed reading with the receipt as printed."""
    items = [(str(i.get('item', '')), cents(i.get('price'))) for i in (obj.get('items') or []) if isinstance(i, dict)]
    prices = sorted(p for _, p in items if p is not None)
    truth_prices = sorted(p for _, _, p in GROUND_TRUTH['items'])
    aligned = []
    for name, words, price in GROUND_TRUTH['items']:
        hit = next((p for n, p in items if any(w in n.lower() for w in words)), None)
        aligned.append((name, price, hit))
    total_items = sum(p for p in prices)
    return {
        'items_read': len(items),
        'price_list_exact': prices == truth_prices,
        'items_sum': total_items,
        'sum_matches_printed_subtotal': total_items == GROUND_TRUTH['subtotal'],
        'subtotal_ok': cents(obj.get('subtotal')) == GROUND_TRUTH['subtotal'],
        'tax_ok': cents(obj.get('tax')) == GROUND_TRUTH['tax'],
        'total_ok': cents(obj.get('total')) == GROUND_TRUTH['total'],
        'count_ok': obj.get('item_count') == GROUND_TRUTH['item_count'],
        'pairs_right': sum(1 for _, want, got in aligned if got == want),
        'aligned': aligned,
    }


def money(c):
    return '-' if c is None else f'{c / 100:.2f}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('image', nargs='?', default=DEFAULT_IMAGE)
    ap.add_argument('--models', nargs='+', default=DEFAULT_MODELS)
    ap.add_argument('--runs', type=int, default=3, help='repeats per model: one run says little about a model that varies')
    ap.add_argument('--timeout', type=int, default=180)
    ap.add_argument('--show', action='store_true', help='print every reading, not just the summary')
    ap.add_argument('--out', help='also write all readings to this JSON file (contains receipt data: keep it private)')
    a = ap.parse_args()

    key = os.environ.get('OPENROUTER_API_KEY') or key_from_dotenv()
    if not key:
        sys.exit('No key found. Set OPENROUTER_API_KEY in your environment, or add the line OPENROUTER_API_KEY=... to .env in the project folder.')
    if not os.path.isfile(a.image):
        sys.exit(f'No such file: {a.image}')

    results = {}
    for model in a.models:
        results[model] = []
        for n in range(a.runs):
            print(f'{model}  run {n + 1}/{a.runs} ...', flush=True)
            r = call(model, a.image, key, a.timeout)
            if r.get('error') and not r.get('text'):
                print(f'   failed: {r["error"]}')
                results[model].append(r)
                continue
            obj = parse(r['text'])
            r['parsed'] = obj
            r['score'] = score(obj) if isinstance(obj, dict) else None
            results[model].append(r)
            if a.show:
                if isinstance(obj, dict) and isinstance(obj.get('entities'), list):
                    # an extraction model: one line per span, without the repeated context text it echoes back
                    for e in obj['entities']:
                        print(f"   {str(e.get('type')):<12} {e.get('confidence')!s:<6} {e.get('text')!r}")
                    extra = {k: v for k, v in obj.items() if k != 'entities'}
                    if extra:
                        print('   other fields:', json.dumps(extra)[:500])
                else:
                    print('   ' + (r['text'] or '').strip().replace('\n', '\n   ')[:2500])

    print('\n' + '=' * 78)
    print(f'Receipt: {os.path.basename(a.image)}   printed: 7 items, subtotal 74.62, tax 4.48, total 79.10, item count 7')
    print('=' * 78)
    for model, runs in results.items():
        ok = [r for r in runs if r.get('score')]
        print(f'\n{model}')
        print(f'  answered {len(runs) - sum(1 for r in runs if r.get("error") and not r.get("text"))}/{len(runs)}, parsed as JSON {len(ok)}/{len(runs)}')
        if not ok:
            for r in runs:
                if r.get('error'):
                    print('  error:', r['error'][:300])
                elif r.get('text'):
                    print('  raw reply (not JSON):', r['text'].strip()[:400].replace('\n', ' '))
            continue
        served = {r.get('served_by') for r in runs if r.get('served_by')}
        print(f'  served by: {", ".join(sorted(served)) or "?"}')
        print(f'  items read: {[r["score"]["items_read"] for r in ok]}   (printed: 7)')
        print(f'  all 7 prices exactly right: {sum(r["score"]["price_list_exact"] for r in ok)}/{len(ok)} runs')
        print(f'  item-to-price pairs right (of 7): {[r["score"]["pairs_right"] for r in ok]}')
        print(f'  items sum to printed subtotal: {sum(r["score"]["sum_matches_printed_subtotal"] for r in ok)}/{len(ok)}   '
              f'subtotal read right: {sum(r["score"]["subtotal_ok"] for r in ok)}/{len(ok)}   tax: {sum(r["score"]["tax_ok"] for r in ok)}/{len(ok)}   '
              f'total: {sum(r["score"]["total_ok"] for r in ok)}/{len(ok)}   count: {sum(r["score"]["count_ok"] for r in ok)}/{len(ok)}')
        secs = [r['seconds'] for r in runs]
        costs = [r['cost'] for r in runs if isinstance(r.get('cost'), (int, float))]
        print(f'  time per read: median {statistics.median(secs):.1f}s'
              + (f'   cost per read: ${statistics.mean(costs):.4f}' if costs else '   cost: not reported'))
        best = max(ok, key=lambda r: r['score']['pairs_right'])
        print('  best run, item by item (printed -> read):')
        for name, want, got in best['score']['aligned']:
            print(f'    {name:<26} {money(want):>8} -> {money(got):>8}  {"ok" if got == want else "WRONG"}')

    if a.out:
        with open(a.out, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f'\nAll readings written to {a.out}')


if __name__ == '__main__':
    main()
