# Audit

A personal finance audit app for phone and web (Expo, React Native). It reads your statements, receipts and cash entries, then shows what you earned, where the money went, what comes next month, and asks questions whenever something is unclear.

## Run it

```bash
bun install
bunx expo start         # press w for web, or scan the QR code with Expo Go
bun run build:web       # static web build in dist/
bun run test            # unit tests for the money logic
bun run typecheck && bun run lint
```

This project uses [Bun](https://bun.sh) (1.4.3, see `.bun-version`) as its package manager, with one lockfile, `bun.lock`. Metro, the Expo dev server and the tests still run on Node. npm and pnpm work too if you delete `bun.lock` first and keep a single lockfile (pnpm needs `node-linker=hoisted`).

Node: `.nvmrc` says 26. Expo SDK 58 accepts 22.13+, 24.3+ and 26; typecheck, lint, tests and the web build pass on all three.

### Versions held back on purpose

- React stays at 19.3.0, React Native at 0.88.0, AsyncStorage at 2.2.0 and react-native-svg at 15.16.0: Expo SDK 58 pins these exact versions and native builds are tested only against them. Use `npx expo install --check` to see the list.
- TypeScript stays on 6.0.x: TypeScript 7 typechecks this project, but typescript-eslint cannot load, so lint breaks.
- ESLint stays on 9.x: eslint-config-expo's React plugin crashes on ESLint 10.
- `bun run lint` calls ESLint directly. `bunx expo lint` 58.0.14 reports false import errors here.

## Privacy and sample data

This repository holds no real financial data, and the app bundles none. It reads your ledger only from your own Supabase project. Without one it shows "Data is not available" and never fake numbers. A fictional sample ledger (`src/data/seed/ledger.sample.json`, rebuilt by `bun run sample`) exists only for the tests and for `bun run ledger:upload --sample`.

Your own statements, ledger, receipts, account list and merchant rules live in git-ignored files (`seed/`, `src/data/seed/merchant-rules.json`, `scripts/extract/`, `.env*`). A test fails if they stop being ignored. See [docs/DATA.md](docs/DATA.md) for the formats and the steps to load your own data.

Two things to remember when you use real data:

- Nothing private is bundled into the app, so a web build does not contain your ledger. Your data is protected by row level security and your sign-in, not by hiding the URL.
- Edits you make (answers, cash entries, saved reports) are stored on the device and synced to your own Supabase project when connected.

## How money is counted

- Spending: purchases, bills and fees, minus refunds.
- Never spending and never income: credit card payments and moves between your own accounts. Each card payment is matched to its bank withdrawal (same amount, within 6 days); unmatched ones are listed under Accounts and data.
- Earned: deposits into checking or savings. Unconfirmed deposits count for now and are flagged until you answer in the Inbox.
- Rewards: tracked apart from earned money.
- Business: developer tools (GitHub, Heroku, Namecheap, Claude, OpenRouter, Upwork) are filed as business automatically. Use the Personal and Business switch to separate them. The forecast leaves business spending out.

Every screen, report and assistant answer runs through one query engine (`src/core/queries.ts`), so a number never differs between screens.

## Layout

```
src/core        pure TypeScript: ledger types, queries, forecast, questions, reports, agent, graph
src/charts      react-native-svg charts (bars, lines, stack, donut, Year to Item graph)
src/app/(tabs)  screens: Overview, Explore, Add, Inbox, Reports, plus Ledger, Forecast, Accounts, Prices, Ask, Cash, Import
src/data        repository (ledger + local edits), assistant client
examples        fictional statements that build the sample ledger
docs            data formats and the ledger JSON Schema
scripts         build the ledger from statement extracts, generate the sample
supabase        optional backend: SQL schema with row level security, two edge functions
tests           node:test suites
```

## Loading your own statements

`bun run ledger` classifies the extracts in `seed/raw/`, pairs card payments with their bank withdrawals and writes `seed/ledger.json` (the transactions), `seed/ledger.raw.json` (the untouched source line behind each one) and `seed/transfer-audit.json`. Statement PDFs differ by bank, so extraction is not part of this repository: write any extractor you like that outputs the raw formats in [docs/DATA.md](docs/DATA.md) (keep it in the git-ignored `scripts/extract/`). Merchant rules: national brands are in `src/core/merchants.ts`, your own go in `src/data/seed/merchant-rules.json`.

## Connect Supabase (sync and sign-in)

Without these steps the app has no data source and shows "Data is not available".

1. Create a project at supabase.com/dashboard.
2. Create the tables: `supabase link --project-ref <your-project-ref>` then `supabase db push` (add `--dry-run` first to see what it will apply). This runs `0001_init.sql` (tables with row level security, private `receipts` bucket) and `0002_evidence.sql` (statements, source lines, receipt details, private `statements` bucket). Without the CLI, paste both files into the dashboard SQL Editor in order.
3. Authentication > Users > Add user: your email and a password, with "Auto Confirm User" ticked. Then Authentication > Sign In / Providers > Email: turn off "Allow new users to sign up", so nobody else can create an account.
4. Copy `.env.example` to `.env` and fill in the project URL and anon key (Project Settings > API).
5. Load your data (next section), then restart with `bunx expo start --clear` and sign in. Until data is loaded the app says "Data is not available".

How sync works: the ledger (accounts and statement rows) is read from the database and cached on the device. Your edits (answers, cash entries, saved reports, receipt items) are written locally first, then pushed about a second later. The app syncs when you sign in and when it returns to the foreground. If two devices edit while offline, the edits are merged and the second device wins on a direct conflict. An Undo made offline on one device can be undone by a stale copy from the other.

Sign out clears the cached ledger and edits from the device.

## Put your data in Supabase

```bash
bun run ledger                    # build seed/ledger.json from seed/raw/*.json
bun run ledger:upload             # sign in as you and upload; asks for email and password
bun run ledger:upload --wipe      # after rebuilding: delete your statement rows first, then upload
bun run ledger:upload --dry-run   # check the file and the sign-in, send nothing
bun run ledger:upload --files <dir>   # folder with the original PDFs and photos (default: the folder above this project)
```

The uploader signs in as your user with the anon key, so row level security applies and no service key is needed. It sends the ledger, then whatever evidence exists next to it: `seed/statements.json` (period, balances, printed totals, terms, rewards per statement), `seed/ledger.raw.json` (the source line behind each transaction) and `seed/receipts.json` (every item, SKU, tax, tip, payment and store detail). The original PDFs and photos named in those records go to private storage buckets. It ends by reading the database back and comparing counts and totals with the file. Re-running is safe; use `--wipe` after changing the ledger.

Receipts are matched to a charge by order number, or by an identical amount within 4 days plus a shared store word, and only when exactly one charge qualifies. Anything else is reported as "NOT linked" and stays attached to nothing until you link it.

In the app, tap a transaction to see its evidence: for a statement row, the statement it came from, the untouched source line and the original PDF; for a receipt, the items and the original image; for an entry you typed, when it was entered and when it was uploaded.


## Import inside the app

Add > Import statements or Import receipts. Choose one file or many (PDFs, photos, or a camera shot). In the web version, **Choose a folder** reads every PDF and image inside it, subfolders included. For every file the app:

1. Fingerprints it (SHA-256). A file already stored is refused before it is read, so nothing is paid for twice.
2. Has the model read everything printed on it (edge functions `ingest-statement` and `ingest-receipt`).
3. **Checks the result before saving anything.** Missing details become questions you answer (or mark "not printed on it"). Numbers that disagree are named and must be fixed or confirmed: receipt items plus tax against the total, a statement's rows against its printed opening and closing balances (it points at a likely missing, duplicated or flipped row), rows dated outside the period, a period already stored.
4. Saves only when nothing is left open. Statements go through the same classifier and stable ids as the desktop script, card payments are paired with the bank side, and the original PDF and every source line are kept. Receipts are linked to their charge when exactly one matches; if several match you choose, and if none matches you keep it as evidence or make it a cash purchase.

### Bulk imports

- **Queue.** Files are read three at a time with a progress bar. Stop and resume at any point. A rate limit or timeout is retried (up to three tries, with a wait); a file the model cannot read is reported and can be typed in by hand.
- **Before any model call.** Junk in a folder (`.DS_Store`, text files, unsupported types) is skipped and named. Identical files, in the folder or already stored, are skipped by fingerprint. If you are adding receipts and a path says `Statements` (or the reverse), those files are left out and the screen says so. This is a guess from folder and file names, so a path that mentions both is not guessed.
- **One line per file.** From four files up, each file is one row: store or account, date, amount, and what is still missing. Filters: Needs answers, Ready, Problems, Saved. Open a row to answer questions or edit it.
- **Save all ready** saves only rows with nothing open, one at a time, statements before receipts, so receipts can link to charges the statements just added.
- **Two documents for one purchase** (a photo and an e-receipt) both attach to the same charge. The first splits its items; the second is kept as an extra document and does not overwrite them. Two identical purchases at one store go to the charge dated the same day as the receipt; if that does not settle it, you choose.
- Nothing in the queue survives closing the page. Anything saved is in the database; anything only read is read again (and paid for again) next time.

### Points and cash-back tables

Some card statements (Chase Amazon Visa, for one) print a points table next to the charges: purchases paid with points, and credits that give points back. Those lines never touch the balance owed, so the app keeps them out of the transactions and out of the balance check. They are stored with the statement (`statements.raw.rewardsActivity`, and the points summary under `statements.terms.points`), the same shape the desktop script uses. If the reader lists them as rows anyway, the review screen says which rows add up to the gap so you can remove them. Counting points-paid purchases as spending is a separate choice the app does not make for you yet. After updating, redeploy the reader: `supabase functions deploy ingest-statement`.

### Duplicate checks

Before anything is saved, each file is compared with what you already hold. The file fingerprint only catches identical bytes; these catch the same purchase arriving in a different shape.

- **Paper receipt and e-receipt.** Same total to the cent, a shared store word and the same day make the second one *another document for the same purchase*. It is stored as evidence, linked to the same charge, marked `raw.duplicateOf`, and it never creates a purchase or splits the items again. One day apart, or any doubt, is a question. A different time, card, store number or order total rules a match out, so two $5 coffees at different times stay separate. Receipts earlier in the same batch count too, and the earlier file is the original.
- **Receipt or cash entry against the ledger.** Adding a receipt as a cash purchase, or typing one in Cash, is stopped when a charge or earlier cash entry has the same amount within four days and the same store or day. You link it to that charge or confirm it is separate. One charge with the right amount but a different store name is offered as a question too.
- **Statement rows against the ledger.** Rows already stored for the same account (same date and amount, similar description, whichever statement or script put them there) are not added again, and the screen says how many. Same date and amount with a different description is a question, so a real second purchase is never lost silently. Two genuine identical purchases are kept as two unless two are already stored. Re-reading the same period updates its rows in place.
- **Limits.** Matching needs a date and a total, so a receipt missing either cannot be matched until you fill them in. Two same-price purchases at one store on one day, with no time printed on either, look like one purchase; the screen says so and "This is a different purchase" undoes it. Duplicates already stored before these checks existed are not merged. Statement rows are matched on the exact printed date.

Choosing "keep as printed" on a difference saves the document as it is and records that it did not reconcile. Editing any value clears earlier confirmations, because they applied to the old numbers.

The reader runs on your backend, so the file is sent to the model provider you configured. Statements contain account numbers. A statement longer than one model answer can hold (roughly a few hundred rows) is refused with a message; split it by month or use `bun run ledger`. Reading quality on your own banks' layouts is not guaranteed: the balance check exists because the reader can be wrong.

## Categories, tags and views

Every charge, and every item on a receipt, has **one category**, which keeps category totals additive. On top of that it can carry any number of **tags** (Health, Household, Work and Kids to start with, plus your own). Tags overlap on purpose: a pharmacy item bought at a big-box store is Household in one view and Health in another, and nothing is counted twice inside a view.

- **Tags are found automatically**, on statement charges and on receipt items alike, from the words (merchant and bank description for a charge, the item text for an item), from the category, and from the Business switch. The words for each tag are yours to edit under **Categories and tags**; a tag can also be set to "only added by hand".
- **You add or take away a tag** on a charge or on any single item from the charge page (a tag the rules found says "auto"; a change you make is kept and wins over the rules). Taking a tag off a whole charge takes it off its items unless an item says otherwise. Each item can also be given **a different category** than its charge.
- **Categories are editable** (Categories and tags): add one, rename it, move it between Need, Want and Mixed, hide it from the pickers, or fold it into another (its charges then count as the other one; nothing on the charges changes, and the merge can be undone). Nothing is deleted, and a category with charges cannot be deleted.
- **Take a photo** works like a document scanner (web version). The photo is decoded on your device, the app suggests the four corners of the paper, and you can drag any corner, press Whole photo, or turn it left or right. The result is straightened, the lighting is evened out (shadows and bright patches removed), the paper turns white and the print darker, in black and white, colour, or as taken. You see the scan before it joins the list, and can use the photo as taken instead. The "Scan photos taken here" switch turns it off. Nothing is sent anywhere by this step and no model is used. On a phone build the photo is used as taken for now. When the paper does not stand out from the surface it lies on, the whole photo is outlined and you place the corners yourself.
- **Income** is where money comes from and what was taken out of it, for any number of sources (a job, a business, dividends, interest, rent). You list your sources, each with optional words that identify its deposits, and say which source an unmatched deposit belongs to. A **pay record** is one paycheck or payout copied from its slip: gross, each tax, each deduction (marked insurance, retirement or other), net, and where it was deposited. It is saved only when gross minus taxes and deductions equals net (and the deposits equal net); nothing is ever adjusted to fit. Each deposit a record names is looked for on your statements (same amount, an account with that last four digits, within four days of the pay date), which proves the deposit and assigns it to the source. The page totals income by source and shows taxes in three views that are never added together: taken from pay (pay records), paid from a bank account (statement lines naming the IRS or a revenue department, judged from the text), and sales tax on imported receipts (a minimum, since only imported receipts count). Premiums and retirement taken from pay are shown too, because they never appear on a statement. It records what documents show and does not work out tax owed or investment gains. Stocks and crypto are tracked only through what reaches an account (dividends, interest, proceeds), not through holdings.
- **Recurring** lists everything that comes round on a rhythm (subscriptions, rent, insurance, bills) and gives the one number to plan around: the fixed amount per month, with yearly and quarterly charges spread across the months. A payee counts once it has billed at least twice at a steady interval (weekly to yearly) and a similar amount; groceries, fuel and shops are not counted unless you confirm them. Each item shows its next expected date, price changes, a late charge, and whether it stopped. You can confirm, set aside or mark one cancelled, and add what no statement shows (rent paid in cash). An **Against your income** card compares the fixed amount with average monthly income over the last three complete months (unconfirmed income is left out and shown separately). Your decisions sync with the rest of your data. Business-marked charges are left out.
- **Views** shows the overall picture for a month or all time: a total, a share of spending, the biggest stores and the charges behind it for each tag, plus **Extras** (everything in categories marked Want). A charge with items counts only the items that carry the tag. The totals overlap and are not meant to add up to the total.
- Stored with the rest of your saved decisions (synced like them), so no database change is needed. Not yet: a tag chosen per receipt before it is linked to a charge, and a tag filter on Explore.

## Redacting a statement before it is read

In the web version, each statement you add is first scanned **on your device** for details you may not want to share: full account and card numbers (the last four digits are kept, so the statement can still be matched to its account), names above an address, street and city lines, phone numbers, email addresses and tax numbers. You then see every page with the boxes it found. Click a box to switch it off or on, drag across a page to cover something it missed, and list words to always hide (your name, street, employer). Only when you press **Use these redactions** are the boxes burned into the pictures of the pages. The reader and your storage get that redacted copy; the original is dropped from memory and never uploaded. Reading the original instead needs a second, explicit confirmation. The switch **Redact statements first** is on the Import screen (on by default).

- **No model and no outside service.** Pages are drawn by pdf.js, text is found by Tesseract (a small recognition engine that runs in the browser), and the new PDF is written by pdf-lib. All three, the Tesseract worker and cores and the English recognition data are served by the app from `public/redact/`, copied there from `node_modules` by `scripts/copy-redaction-assets.js` (after install and before start; the copies are git-ignored). Nothing is fetched from a CDN.
- **Recognition is only used to find places.** It misreads digits (on a real statement it read 9780 as 9750), so its text is never given to the reader. The reader gets the redacted picture itself.
- **The redacted pages are flattened pictures**, so there is no hidden text under a box. A PDF that had a text layer loses it; the reader reads the pictures. On a real 3-page statement the redacted copy read back at the same average recognition confidence and 51 of 52 amounts matched.
- **Limits.** Web only for now (phones keep reading statements as they are). Detection is rules plus your word list, so a name or address it does not recognise is one you cover by hand; that is why you always review. Receipts are not redacted yet. The saved statement records whether it was redacted (`raw.redaction`), and its fingerprint is still the original file's, so importing the same statement again is recognised as a repeat.

## Several numbers for one account

A card is reissued, an account number changes, a debit or credit card belongs to a checking account: all of them are the same account. **Accounts** (Overview > Accounts and data, or the Import screen) lists every account and lets you add numbers to it (migration `0004_account_numbers.sql`, run once). A statement or receipt that carries any of an account's numbers counts as that account. When you import a statement whose number is new but whose bank you already have, the card asks "Same as <account>?" so its statements stay in one account. **Merging** (migration `0005_merge_accounts.sql`): if a statement with a changed number already created a second account, press **Merge into another account** on it. Its transactions and statements move to the account you keep, its numbers are added to that account, and it is hidden, not deleted. The whole merge is one database transaction, and **Undo** (bottom of Accounts) moves everything back. Only accounts of the same type can be merged, never the cash account.

## Receipt links

A link says which receipt belongs to which statement charge. It is its own record, in the `receipt_links` table (migration `0003_links.sql`, run it once), many to many: a receipt can explain more than one charge and a charge can have more than one receipt (an order confirmation and a store receipt).

- **Saving a receipt** links it at once when the evidence is strong: an order number, or the same store, amount and date. When only the amount, the date and your card agree but the bank prints a different store name, the app proposes the charge and you confirm it.
- **Importing a statement** afterwards links the receipts you saved earlier that now have their charge. Import order does not matter.
- **Links screen** (Overview, Import, or a charge): receipts with no charge and why (no statement for that date, a card that is not loaded, several charges fit, no such charge), charges with no receipt, suggestions to confirm, and every link with how it was made. You can choose a charge yourself, unlink, or mark the receipt as paid another way (cash, another account, a gift card or points) or the charge as "no receipt expected". Marked items are not listed as unlinked.
- A cash purchase added from a receipt is linked to its cash entry.
- A charge takes its item lines from its linked receipt, so correcting the receipt corrects the charge.
- Not yet: remembering a rejected suggestion across visits (it is hidden until you reload), and the desktop `bun run ledger:upload` does not write links.

To start over while testing, `supabase/reset_test_data.sql` (run by hand) empties your tables.

## The assistant and receipt photos

Both run as Supabase edge functions, so they work once the steps above are done and the functions are deployed:

```bash
brew install supabase           # other platforms: https://supabase.com/docs/guides/local-development/cli/getting-started
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set OPENROUTER_API_KEY=<your key> ALLOWED_EMAIL=<your email>
supabase functions deploy ask
supabase functions deploy ingest-receipt
supabase functions deploy ingest-statement
```

The model is fixed, never chosen per request. It defaults to `anthropic/claude-haiku-5.5` (supports tools and image input). To change it:

```bash
supabase secrets set OPENROUTER_MODEL=anthropic/claude-sonnet-5.5    # optional
supabase secrets set OPENROUTER_VISION_MODEL=<model id>               # optional, receipts and statements
supabase secrets set OPENROUTER_VERIFY_MODEL=<model id>               # optional, second reading of a statement that fails its balance check (use a different model from the one above)
supabase secrets set OPENROUTER_MODEL_CHOICES=anthropic/claude-sonnet-5.5,google/gemini-3.8-flash   # optional: extra readers offered on a review card (the models above are offered already)
supabase secrets set OPENROUTER_DATA_COLLECTION=allow                 # optional, default is deny
supabase secrets set OPENROUTER_PDF_ENGINE=mistral-ocr                # optional: native | mistral-ocr | cloudflare-ai (see below)
```

Requests send `provider.data_collection: "deny"`, so OpenRouter only routes to providers that do not store or train on prompts. If a model has no such provider you get an error naming this setting. Create the key at https://openrouter.ai/settings/keys and add credit first.

Until then the app uses a built-in keyword planner, and receipts can be typed by hand in Import. The model never sees your ledger and never runs code. It can call five fixed read-only tools (query, transactions, summary, forecast, make_report). The tools run on your device, and report specs are validated against a whitelist before anything is drawn. Document reading fills the review for you to check; nothing is saved without your confirmation.

## Known limits

- Prices needs itemised receipts. Bank lines have no items, so the comparison stays empty until receipts are added.
- Reading PDFs: OpenRouter's PDF handling depends on the engine. Unset, it uses its default for the model. `mistral-ocr` reads scanned or garbled-text PDFs and is billed per page by OpenRouter (check current pricing); `cloudflare-ai` is free and converts the PDF to markdown; `native` works only for models that accept PDFs directly. Which works best on your banks' PDFs is untested here.
- In-app import has been tested against a mocked backend, not against a live model or Supabase project. Bulk import was tested with about 25 files in a browser. Every picked file is held in memory until saved, so on a phone import a few dozen at a time; use the web version for hundreds. Folder picking is web only, because phones have no folder chooser.
- CSV statements are not read in the app yet.
- The Supabase schema, uploader, sync and edge functions are tested against a local stand-in for the API, not yet against a live project. Run `supabase db push` and `bun run ledger:upload` once and check the printed comparison.
- The offline planner understands common phrasing only. Use the assistant for anything else.
