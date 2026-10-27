# Spending-only Contributor: implementation plan

## Goal

You invite someone as a **Contributor**. They add receipts and credit card statements to *your* books and see only spending. The app looks like a spending tracker to them: nothing says that earnings, savings, pay slips or balances are recorded.

| A Contributor sees | A Contributor never gets |
|---|---|
| Spending, refunds and fees, with your categories and tags | Deposits, salary, Earned, Rewards, "Left after spending" |
| Recurring bills, prices, receipts and receipt links | Transfers (card payments, moves to savings) |
| The Inbox, with spending questions only | The Income page, pay slips, income sources |
| Upload screens for receipts and credit card statements | Statements you uploaded, opening and closing balances |
| Ask, answering from spending only | The Accounts page, People, the savings set-aside |

They are still told that you can see everything they add, as the invite says today.

## Settled decisions

1. **Contributor changes meaning.** Today it means "adds entries and sees only their own" (`src/core/workspace.ts:13`). It becomes "adds to your books and sees your spending". The migration stops with an error if anyone still holds the old role, so nobody's access changes without you knowing.
2. **Checking statements are yours to upload.** Contributors can upload credit card statements and receipts. A statement that reads as a checking account is refused with "Checking statements are added by the person who runs this workspace."
3. **They can fix, not delete.** They can change the category, subcategory, note, tags and item lines of a charge, and attach receipts. They can't delete rows, change a row's kind, or overwrite a row you already have.
4. **Branch.** A new branch `contributor-spending` off `dashboard-redesign`, because the Overview and side bar it changes are the redesigned ones. The migration is therefore `0009`.

## Design rules

- **The database decides, not the app.** This is how 0006 already works. A Contributor's phone only ever receives spending, so nothing can be revealed by hiding screens, inspecting the network or using an old version of the app.
- **Reads go through one `security definer` function** that returns chosen columns only. Plain row-level security can filter rows but not columns. For example, `accounts.income_complete` would leak through it.
- **Your patches are applied in the database before filtering.** A row's kind is your patch's kind, if you set one, and otherwise the stored kind. A deposit you reclassified as a refund shows. A charge you marked as income doesn't.
- **Two people never write the same row**, as in 0006. A Contributor's changes go to their own table. Your app lays them under your own decisions, so yours win.
- **A Contributor's uploads never overwrite your rows.** New transactions are inserted with `on conflict do nothing`.

## Phase 1: database (`supabase/migrations/0009_contributor_spending.sql`) (done)

Tested in `tests/contributor.test.ts` (PGlite, the project's own migrations).

A Contributor gets **no new access to any data table**. Every read and write goes through a `security definer` function that checks its arguments. The only direct access they get is to files: they can add and open receipt photos in your folder, and add (never open) statement files.

- **Guard:** the migration stops if anyone holds the old Contributor role. Once it has run, it can be run again safely.
- **Helpers:** `contributor_owner()` and `tag_edit_txn_id(key)`. `owner_spending(owner)` and `contributor_sees(owner, kind, ref)` are internal, and the app can't call them.
- **`uploaded_by`** on `receipts` and `statements`.
- **Reading:** `contributor_spending()` returns `{owner, accounts, txns, statements, receipts, links, flags, categories, tags}`:
  - Your patches and merchant rules are applied in the database, and only spend, fee and refund rows come back. Cash entries are included.
  - Accounts show only if they hold spending, or are credit cards. Statements come back as periods only, with no balances. Receipts linked only to hidden rows are left out.
  - Never sent: `income_complete`, subtypes or pairs, income hints, or your other decisions.
- **Writing:**
  - `contributor_edits`: the Contributor's own rows. A trigger lets them change only spending they can see, and only allowed fields. You can read and delete these rows, but not change them.
  - `contributor_save_receipt`, `contributor_update_receipt`: they can change only the receipts they added.
  - `contributor_save_links`, `contributor_delete_link`, `contributor_set_flag`, `contributor_clear_flag`: these only work on spending.
  - `contributor_file_seen`: yes or no only.
  - `contributor_save_statement`: credit cards only. No income rows. Every row has to be on that card. Rows are added with `on conflict do nothing`, card payments are left unpaired, and the answer counts spending only.

## Phase 2: backend functions (done)

- **`_shared/access.ts`:** the rules didn't change: Contributors still need `can_read_ai` for the readers. The comment now says the Contributor's books are decided by the database.
- **`ingest-statement`, `ingest-receipt`, `ask`:** unchanged. The readers return the reading of a file the Contributor holds. Ask runs its tools on the device against what was loaded, which for a Contributor is spending only.
- **`invite-member`:** unchanged. The invite email is Supabase's own template and says nothing about income. What the owner reads at invite time (`visibilityNotice`) now explains the new role.

## Phase 3: the app's data layer (done)

- **`src/core/contributor.ts`:**
  - `spendingView`: the database's spending rule in TypeScript, tested row for row against `contributor_spending()` on the whole fictional ledger.
  - `editsFromOverlay`, `diffEdits`, `overlayFromEdits`: a Contributor's decisions as `contributor_edits` rows.
  - `layerContributorEdits`: on the owner's side, for display only, with the owner's own decisions winning.
  - `newCardPairs`: pairs card payments that have no partner yet.
- **`src/data/contributor.ts`:** the RPC calls, pushing edits, the owner reading edits, saving pairs.
- **`src/data/scope.ts`:** `contributorOwner()`. Once it is set, `intake.ts`, `links.ts` and `evidence.ts` send every read and write through the contributor functions, so a screen never touches a table.
- **`src/data/repo.tsx`:**
  - **For a Contributor:** it loads the snapshot instead of the ledger, the owner's categories and tags are shown, and their own decisions stay in their own overlay and are mirrored to `contributor_edits`. The role is remembered on the device, so the narrower app shows from the first moment.
  - **For the owner:** members with the Contributor role aren't loaded as people with books of their own. Their edits are laid under the owner's. Unpaired card payments are paired on sync.
- **Import:**
  - A statement that reads as checking or cash can't be saved ("Only credit card statements can be added here…").
  - Cash purchases aren't offered.
  - The saved message counts spending only.
  - The review still shows the card statement as it was read. It's the Contributor's own paper, and a checking statement never gets that far.

## Phase 4: what a Contributor's screens show (done)

| Place | Change |
|---|---|
| Side bar | No Accounts, Income, Categories and tags. People stays, with spending-only wording about their place |
| Income, Accounts, Categories, Cash | `ownerOnly()`: a plain "Not available" page if reached by address |
| Dashboard | No `cashflow` or `bizPL`, in any view or in Customize. "Month at a glance" shows Spent only. "Business at a glance" has no business income tile. The Overview caption speaks only of where the money went |
| Transactions | No Earned or Rewards labels. "Spending in these rows" instead of "Net outflow" |
| Transaction page | No merchant rename, no "+ New tag", no "Manage categories and tags". Evidence shows receipts only, never the statement line or its balances |
| Recurring | No "Against your income" card |
| Add | Card statements and receipts, no cash |
| Ask and Reports | A spending-only prompt and tools (`toolsFor`). Queries and summaries are about spending only. Reports that speak of pay or savings are refused (`notSpendingOnly`). The built-in planner never adds Earned. Spending-only suggestions |

## Phase 5: tests and checks (done)

- **`tests/contributor.test.ts`** (PGlite, the migration): what the Contributor gets, every way in, writes, statements, the guard.
- **`tests/contributor-app.test.ts`:**
  - the app's spending rule matches the database's on the full fictional ledger
  - the preview fixture holds no income
  - edits come back the same
  - the owner's layering
  - card pairing
  - Ask and Reports in spending-only mode
  - the dashboard catalog
- **`tests/workspace.test.ts`:** the new wording. What a Contributor reads about themselves speaks only of spending.
- **Preview** (`EXPO_PUBLIC_FIXTURE=contributor`): every screen's text was searched for income, earn, salary, deposit, saving, rewards, net, balance, transfer, "came in" and similar words. The only hits left are a fictional card's name ("Meadow Rewards card") and the shopping tip "savings there can't be found yet". The owner preview (`full`) is unchanged.

## What this can't protect

- **The paper.** Any statement the Contributor holds shows what is on it. That is why checking statements stay with you.
- **Account names.** A credit card called "Savings Rewards Visa" shows its name. Rename accounts you'd rather not show.
- **Business spending** is visible, since it is spending. If it shouldn't be, phase 1 filters out `business = true` rows. It's one line, so decide before the migration.

## After this

The savings set-aside (a monthly amount taken off "Left after spending") is owner-only, so Contributors never see it. Build it once this is in.
