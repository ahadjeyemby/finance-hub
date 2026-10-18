# Data: what is public, what is private, and the formats

This repository contains **no real financial data**. Everything below marked private is git-ignored (see `.gitignore`), and `tests/data.test.ts` fails if those paths ever stop being ignored.

| Path | What it is | In git? |
|---|---|---|
| `examples/accounts.json`, `examples/raw/*.json` | Fictional statements, same shape as real extracts | yes |
| `src/data/seed/ledger.sample.json` | Ledger built from `examples/` | yes |
| `src/data/seed/merchant-rules.sample.json` | Example of your own merchant rules | yes |
| `docs/schema/ledger.schema.json` | JSON Schema of the ledger | yes |
| `seed/accounts.json`, `seed/raw/*.json` | **Your** accounts and statement extracts | **no** |
| `seed/ledger.json`, `seed/ledger.raw.json`, `seed/transfer-audit.json` | **Your** built ledger, the source line behind each row, and unmatched card payments | **no** |
| `seed/statements.json`, `seed/receipts.json` | **Your** statement records and receipts, with every detail kept for later | **no** |
| `src/data/seed/merchant-rules.json` | **Your** merchant rules (local shops, clinics, schools) | **no** |
| `scripts/extract/` | **Your** statement extraction scripts | **no** |
| `.env`, `.env.*` | Supabase URL and keys | **no** |

A fresh clone has no private files and the app bundles no ledger. `bun install` runs `scripts/init-seed.js`, which only copies `merchant-rules.sample.json` into place so the build has rules to read. It never overwrites an existing file. Data reaches the app through Supabase (see `bun run ledger:upload` in the README).

## Use your own data

1. Copy `examples/accounts.json` to `seed/accounts.json` and describe your accounts.
2. Put one extract per account in `seed/raw/` (formats below).
3. Run `bun run ledger`. It writes `seed/ledger.json`, `seed/ledger.raw.json` and `seed/transfer-audit.json` (card payments that found no matching bank withdrawal).
3b. Or skip steps 1 to 3 and use Import in the app, which does the same analysis on a PDF or photo and asks about anything missing.
3c. Optional: add `seed/statements.json` (one record per statement) and `seed/receipts.json` (one per receipt), then `bun run ledger:upload`. Original files are referenced by `sourceFile`, relative to the folder passed with `--files`. Record shapes: `StatementRecord` and `ReceiptRecord` in `src/core/evidence.ts`. If two receipts are the same purchase (a paper photo and its e-receipt), `ledger:upload` keeps both as evidence, links both to the one charge, and marks the later one with `raw.duplicateOf` (the id of the first). Neither creates a second purchase.
4. Optional: copy `merchant-rules.sample.json` to `merchant-rules.json` and add your own shops.

Rebuild the fictional sample with `bun run sample`. It is deterministic.

## `accounts.json`

```json
{
  "windowStart": "2026-06-01",
  "accounts": [
    {
      "id": "northwind-chk-1111",
      "name": "Northwind checking",
      "institution": "Northwind Bank",
      "type": "checking",
      "last4": "1111",
      "coverage": { "from": "2026-06-01", "to": "2026-09-15" },
      "incomeComplete": false,
      "source": { "format": "bank", "file": "bank1111.json", "label": "Northwind checking" }
    }
  ]
}
```

- `type`: `checking`, `credit` or `cash`. Only deposits into `checking` can become income.
- `coverage`: the days you hold complete statements for. Months that are only partly covered are hatched in charts.
- `incomeComplete: false`: other accounts may hold deposits you have not added, so Earned is shown as incomplete.
- `windowStart`: rows before this date are dropped.
- `source.format` is one of the four raw formats below. Accounts without `source` (cash) have no import file.

## Raw formats (`seed/raw/<file>`)

All amounts are dollars as printed on the statement, dates are `YYYY-MM-DD`.

**`bank`** (checking: negative leaves the account)
```json
{ "statement": "sample-2026-06", "date": "2026-06-01", "description": "ACME CORP PAYROLL DES:PAYROLL ID:000123", "amount": 2150 }
```

**`card`** (credit card with separate payment and purchase sections: both amounts positive)
```json
{ "statement": "sample-2026-06", "section": "pur", "date": "2026-06-03", "description": "KROGER #512 SPRINGFIELD IL", "amount": 84.19 }
```
`section` is `pur` (purchase) or `pay` (payment or credit).

**`card_orders`** (credit card where purchases are positive, payments negative, with an optional order number)
```json
{ "statement": "sample-2026-06", "date": "2026-06-03", "description": "AMAZON MKTPL*KX97Y AMZN.COM/BILL WA", "amount": 30.49, "order": "D01-0000001-2249536" }
```

**`apple`** (a card export that carries its own category; purchases positive, payments negative; `merchant` is what the classifier reads)
```json
{ "date": "2026-06-05", "description": "TRADER JOES #101 SPRINGFIELD IL USA", "merchant": "Trader Joes", "appleCategory": "Grocery", "type": "Purchase", "amount": 62.4 }
```

## How rows are classified

`src/core/classify.ts` decides what each row is. Money moving between your own accounts is recognised first, so a card payment is never income on the card or spending on the bank. Merchants are then matched by `src/core/merchants.ts`: national brands ship in the repo, and your own rules in `merchant-rules.json` run first and can override them.

## `merchant-rules.json`

```json
[
  { "re": "joes diner", "merchant": "Joe's Diner", "category": "restaurants" },
  { "re": "mystery gadget", "merchant": "Mystery Gadget Shop", "category": "uncategorized", "hints": ["unknown_merchant", "business_or_personal"] }
]
```

`re` is a regular expression source matched against the lower-cased bank description. First match wins. Optional fields: `subcategory`, `hints`, `business` (filed as business without asking). Valid categories and hints are listed in `docs/schema/ledger.schema.json`.

## `ledger.json`

Described by `docs/schema/ledger.schema.json`. Sign convention: `cents` is from the account holder's point of view, negative when money leaves. Each `kind` is one of `spend`, `fee`, `refund`, `income`, `rewards`, `transfer`; transfers (card payments and moves between your own accounts) are never spending and never income.
