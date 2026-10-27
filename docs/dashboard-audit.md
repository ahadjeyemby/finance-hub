# Dashboard audit

Section 0 of `docs/FINORA_DASHBOARD_HANDOFF.md`. It was written before any dashboard code changed (2026-10-22, base commit `1ebd152`).

Two independent audits were made: one by Claude, one by Codex. Each checked the other's claims against the source, and this document merges them. Where they disagreed, the accepted position and the reason are recorded in section 5.

The design source is `design-reference/Main.dc.html` and `design-reference/Phone.dc.html`. Both are gitignored (`.gitignore`, added in `4471c91`), and `git log --all -- design-reference` is empty. That proves the folder has no history; it does not certify that the same content never appeared under another path, so a privacy scan of the whole history runs at the end of the build. No figure, account or merchant name from the references appears in this document or anywhere else in the repo.

## Summary

- **Today the dashboard is one screen, `src/app/(tabs)/index.tsx` ("Overview").** It has five cards, two chart cards and a set of banners in a fixed two-column layout. There is no widget registry, no view presets, no Customize panel and no per-user preferences.
- **Matches the design: 0 of 22.**
- **Exists but needs changes: 5 of 22** (kpis, donut, trend, forecast, attention).
- **Missing from the dashboard: 17 of 22.** Ten of them can reuse logic that already exists in `core/` or on other screens. Seven need new rules.
- **Nothing supports dark mode.** All 43 files that style anything import a fixed light palette `C` from `src/theme/tokens.ts`. `app.json` sets `"userInterfaceStyle": "light"`, and `StatusBar` is hard-coded to `dark`.
- **Theme tokens and fonts differ from the brief**, so step 2 changes the look of every screen.
- **Existing code has correctness issues the widgets would inherit** (section 3). They are fixed in `core/` before the widgets are built.

## 1. What exists today

Everything below lives in `src/app/(tabs)/index.tsx` and reads the `useRepo()` context (`src/data/repo.tsx`). That context loads the signed-in user's accounts and transactions from Supabase. On the client it applies the user's overlay (answers, patches, merchant rules, tags, recurring decisions, income assignments) and the receipt links. Totals come from the pure functions in `src/core/`. Every item is **light only**.

| # | Current card | What it reads | Maps to |
|---|---|---|---|
| A | Headline `TapeCard`: Spent (large), Earned, Rewards, Left after spending | `summarize(ctx, range.from, range.to, scope)` in `core/queries.ts` | **kpis** |
| B | "Where it went": `ChartCard` + `HBars`, top 6 categories | `categoryRows(ctx, filter, 6)` in `lib/rows.ts` | **donut** |
| C | "Spending by month": `ChartCard` + `Bars`, one bar per month, partial months hatched | `runQuery({ metric: 'spend', groupBy: 'month' })`, `completeTo` | **trend** |
| D | "Questions": count, dollars at stake, "Answer questions" | `questions` from `buildQuestions()` in `core/questions.ts` | **attention** |
| E | "Forecast for <month>": number, range as text, confidence, "See how it is built" | `forecastMonth()` in `core/forecast.ts` | **forecast** |
| F | "Ask about your money" | links to `/ask` | Not a widget. Moves to the top-bar Ask field. |
| G | "More": 9 link buttons | routes | Not a widget. Replaced by the sidebar. |
| H | Banners: receipts dated after the newest statement, income incomplete, unconfirmed Earned, statements ending early | `links.receipts`, `summarize()` | Folded into **kpis** (Earned chip, income-incomplete note) and **dataHealth** (coverage, receipts waiting). |
| I | `PeriodBar`: month chips + All, and the Everything / Personal / Business switch | `useRepo().period`, `scope` | The month chips become the header's segmented control. The scope switch is removed from the dashboard, because each view now sets its own scope (section 4). |

The empty-data gate also matters. `src/app/_layout.tsx` (`Gate`) puts `NoData` in place of every route except `/import` and `/people` when there are no accounts. A new user could therefore never see a widget in its locked state. This is changed in step 3 (decision in section 4).

Other screens already compute data that the missing widgets need:

| Screen / module | Already computes | Feeds |
|---|---|---|
| `forecast.tsx`, `core/forecast.ts` | repeating vs everyday split, one-offs left out, `pace`, basis months, confidence, low/high | forecast, forecastBuild, pace, oneTime |
| `recurring.tsx`, `core/recurring.ts` | `summarizeRecurring()`: cadence, `monthlyCents`, health, status, confirmed/detected/manual; `fixedMonthlyCents` | subscriptions, fixedFlex, cutIdeas (b), bizTools, billsOnce |
| `prices.tsx` | per-item average price per store from receipt lines | grocery, cutIdeas (a) |
| `accounts.tsx` | coverage bars per account; unmatched card payments split into card side and bank side (lines 137–140) | dataHealth |
| `income.tsx`, `core/income.ts` | `IncomeSource` with type `business`, `attribute()` / `summarizeIncome()` link deposits to sources | bizSummary, bizPL |
| `core/questions.ts` | `business_or_personal` (per merchant), `one_off`, `transfer_account`, `confirm_income`, `items`, `category`, `person_payment` | attention and every "Needs your answers" trigger |
| `charts/stack.tsx` | `Donut` (SVG arcs with gaps), `StackBars` | donut, bizDonut, trend |
| `charts/bars.tsx`, `charts/common.tsx`, `charts/lines.tsx` | `Bars` with an SVG hatch `Pattern`, `HBars`, `HatchDefs`, `LineChart` | trend, fuel, subscriptions, bizPL, dataHealth, pace |
| `assets/brand/svg/` | the 01, 04, 05 and 06 symbol and wordmark SVGs the brief names | header, sidebar |

## 2. The 22 widgets against what exists

Status: **Changes** means it exists on the dashboard but must change; **Missing** means it is not on the dashboard. The thresholds for grocery, pace and bizPL come from the brief; every other readiness rule is defined here.

**How readiness is decided (all widgets):**
- **Needs more data** when the widget's minimum evidence is absent. It shows a dashed ghost chart, says what is missing, and gives one specific action.
- Otherwise, **Needs your answers** when an open question of a type the widget depends on touches the charges it counts. The widget still shows its provisional chart, with a prompt linking to those questions.
- Otherwise **Ready**.
- There are no dollar thresholds.
- A zero over months the statements cover is a real answer, so it counts as Ready, with an empty state.
- Loading, sync errors and sign-in are app states, not readiness states.

### Big picture

**1. kpis: Month at a glance** (L, Numbers). **Changes** (from A).
- What changes: four tiles, with Spent as the hero tile. Spent's change vs the previous month shows only when both months are complete; otherwise it says why it is missing. A "Not confirmed yet" chip goes on Earned. Rewards is its own tile.
- Data: `summarize()`.
- Answers: `confirm_income` questions in the month.
- More data: no statement covers any day of the month. Action: Import a statement.

**2. cashflow: Money in vs out** (M, Waterfall). **Missing.**
- Data: `summarize()`: `earned`, `spent`, `transfers` (the "Not counted" note).
- It must handle Earned at zero and a negative "Left".
- Readiness: the same as kpis.

**3. donut: Where it went** (S, Donut). **Changes** (from B).
- What changes:
  - a donut over **all months with statements**;
  - a total in the centre;
  - a legend with amount and % to one decimal;
  - the six fixed category colours.
- `colorOf()` currently ranks categories by spend, so a category's colour can change. It is replaced by a fixed map, and every other category folds into "Everything else".
- Reuses: `Donut`.
- Answers: open `category` questions.
- More data: no spending at all. Action: Import a statement.

**4. trend: Spending by month** (M, Stacked bars). **Changes** (from C).
- What changes:
  - category stacks;
  - the selected month outlined;
  - partial months hatched and labelled "so far";
  - a dashed average over complete months only, left out with a note when there are none.
- Reuses: `StackBars`, `HatchDefs`.
- Answers: open `category` questions.
- More data: no covered month.

**5. oneTime: One-offs vs normal months** (S, Ring). **Missing.**
- Data: `Txn.oneOff` and the `one_off` questions.
- The ring shows confirmed one-offs only. Candidates still waiting for an answer are not counted as one-offs.
- Answers: open `one_off` questions.
- More data: no covered spending.

### Save money

**6. cutIdeas: Where you could spend less** (M, List). **Missing.** Four new rules, shown at most four at a time. A rule with no figure is hidden, never shown as zero.
- (a) **Cheapest store for the usual basket.** From the shared price comparison (`core/prices.ts`, see section 3).
- (b) **Repeating bills per year.** Active recurring items × `monthlyCents × 12`. Not `yearCents`, which is past spending and is 0 for bills added by hand.
- (c) **Big-box spend with no item detail.** `mixed_retail` charges with the `needs_items` hint and no `lines`.
- (d) **The biggest month-over-month rise in a category.** Adjacent complete months only.

Readiness:
- Ready when at least one rule has a figure.
- Answers: open `items` questions, which unlock rule (c).
- More data: no rule has a figure. Action: Add receipts.

**7. fixedFlex: Fixed bills vs everyday** (S, Ring). **Missing.**
- Data: repeating bills (from the unified recurrence, section 3) vs the everyday average over complete months.
- The warning shows when no recurring item is in `housing` or `utilities`. **Neither category exists today**, so both are added to `core/categories.ts`, with merchant keywords in `core/merchants.ts`.
- Answers: detected bills not yet confirmed.
- More data: no complete month.

**8. subscriptions: Repeating bills** (S, Bars). **Missing** (the Recurring screen lists them).
- Data: active recurring items sorted by `monthlyCents`, with monthly and yearly (× 12) totals.
- Answers: detected but unconfirmed items.
- More data: no covered month and no bills added by hand. With covered months and no bills, it shows an empty Ready state.

**9. grocery: Cheapest store for your basket** (S, Table). **Missing** (the Prices screen has a version).
- Data: from `core/prices.ts`. Items are matched by normalised name, and the widget is labelled "compared by item name".
- The saving is measured against the **next** cheapest store. The current screen measures it against the most expensive (`prices.tsx:28`), which overstates it.
- Receipt lines are `{ item, cents }` with no pack size or unit, so the widget does not require them.
- More data until 3 or more items have prices from 2 or more stores (the brief's rule). Action: Add receipts.

**10. bigbox: Big-box stores** (S, Split bar). **Missing.**
- Data: `mixed_retail` spend by merchant.
- Answers: open `items` questions for those stores.
- More data: no covered month. Covered with no big-box spend: an empty Ready state.

**11. fuel: Fuel** (S, Bars). **Missing.**
- Data: the `fuel` category. Shows the total, the number of fill-ups (refunds don't count), the average, monthly bars with the partial month hatched, and the top station's share.
- Answers: open `category` questions.
- More data: no covered month. Covered with no fuel: an empty Ready state.

### Plan ahead

**12. forecast: Next month forecast** (S, Range). **Changes** (from E).
- What changes: a range band on a 0-to-max scale, a confidence chip, and a link that switches to the Plan ahead **view**.
- The target is always the month after the latest statement, whatever month is selected, and the label says which month.
- Answers: open `one_off` questions about charges in the months the forecast is built from. Detected but unconfirmed bills prompt on Repeating bills and Fixed bills vs everyday instead, where confirming them is the action.
- More data: no complete month.

**13. forecastBuild: What next month is made of** (M, Split bar). **Missing.**
- Data: the repeating part, the everyday part, one-offs left out on purpose, and the "if the bills seen once repeat" figure (from billsOnce).
- It uses the same model as forecast, so the two always agree.
- Readiness: the same as forecast, plus billsOnce candidates waiting for an answer.

**14. pace: Month pace** (M, Line). **Missing.**
- Data: a new daily cumulative series for the target month, drawn against a straight line to the forecast total.
- One-offs are excluded, like the forecast (section 3).
- More data until 7 days of the month are covered by statements (the brief's rule).
- Answers: open `one_off` questions dated in the month.

**15. billsOnce: Bills seen once** (S, List). **Missing; there is no logic yet.**
- Candidates: charges in a bill category (insurance, phone, subscriptions, education, housing, utilities) from a merchant seen only once, with no decision recorded.
- "Repeats monthly" confirms the bill in `RecurringState`. "One-time" sets `oneOff`.
- Both answers change the forecast once recurrence is unified (section 3). Today they would not.
- Answers: when candidates exist.
- Ready: "Nothing seen only once".
- More data: no complete month.

### Business

**16. bizSummary: Business at a glance** (L, Numbers). **Missing.**
- Data:
  - business-tagged spend (`Txn.business === true`);
  - the total waiting for an answer, each charge counted once;
  - likely business tools per month (from bizTools), shown apart from confirmed totals;
  - business income: deposits attributed to a `business` `IncomeSource` through `attribute()`.
- The "Not connected" tile shows when no business source has an attributed deposit.
- Answers: open `business_or_personal` questions.
- More data: nothing tagged business and nothing waiting.

**17. bizPending: Business or personal?** (M, List). **Missing** (the same questions are in the Inbox).
- Data: the `business_or_personal` questions, one per merchant.
- The buttons answer for every charge from that merchant through a batch answer (section 3).
- Answers: when any are open. Ready: "All answered".
- More data: no charge has ever had the business hint.

**18. bizDonut: Waiting, by merchant** (S, Donut). **Missing.**
- The waiting amount split by merchant, each charge counted once.
- Readiness: the same as bizPending.

**19. bizTools: Software and tools** (S, List). **Missing.**
- Candidates: active recurring items in `subscriptions` or `electronics`, or matching a software keyword list.
- Charges already confirmed as business stay visible. A merchant the user answered "Personal" is never offered again.
- "Mark all as business" acts only on undecided candidates, in one batch.
- Answers: undecided candidates.
- More data: no recurring software charge.

**20. bizPL: Business profit and loss** (M, Bars). **Missing.**
- Business income minus business spend, per complete month.
- More data until a business `IncomeSource` has at least one attributed deposit **and** at least one month has business-tagged spend (the brief's rule, made concrete with the existing income model). The action names whichever half is missing.
- Answers: open `business_or_personal` questions in the range.

### Keep it accurate

**21. attention: Needs your attention** (S, List). **Changes** (from D).
- What changes: the open count, the top 3 by amount with their amounts, and a primary "Answer questions" button.
- The total at stake counts each charge once: one charge can sit in several questions (section 3).
- Ready always, including with open questions, since reporting them is its job. With none open it shows "Nothing is waiting".
- More data: no data at all.

**22. dataHealth: Data health** (S, Bars). **Missing** (`accounts.tsx` draws the same coverage).
- Coverage per account comes from the statement periods, not the first-to-last envelope. Gaps are drawn as a hatched track.
- The warning totals **card-side** unmatched card payments only: credits on a credit account with no `pairId`, meaning they were paid from an account Finora can't see. Bank-side unmatched payments mean a card statement is missing; they are shown separately and never added to the first figure.
- The "receipts dated after the newest statement" note moves here.
- Answers: open `transfer_account` questions.
- More data: no accounts.

### Tally

| Group | Changes | Missing |
|---|---|---|
| Big picture | kpis, donut, trend | cashflow, oneTime |
| Save money | | cutIdeas, fixedFlex, subscriptions, grocery, bigbox, fuel |
| Plan ahead | forecast | forecastBuild, pace, billsOnce |
| Business | | bizSummary, bizPending, bizDonut, bizTools, bizPL |
| Keep it accurate | attention | dataHealth |
| **Total** | **5** | **17** |

## 3. Correctness issues in existing code (fixed before the widgets)

1. **Two recurrence engines.** `core/forecast.ts` detects repeating merchants itself and never reads `RecurringState`, while `core/recurring.ts` holds cadence, manual bills and the user's confirmations. The result: a "Repeats monthly" answer does not move the forecast, and on the same view forecastBuild and fixedFlex would show different "repeating" totals. **Fix:** `forecastMonth()` takes its repeating part from `summarizeRecurring()`.
2. **Pace counts one-offs.** In `forecastMonth()`, the target-month filter excludes business spend but not one-offs, while the basis months exclude both. **Fix:** exclude one-offs there too.
3. **Coverage is an envelope.** `Account.coverage` is the first and last statement day, so a missing statement in between still counts as a complete month. Also, `completeMonths()` calls every month complete when there are no spend accounts, because `every()` on an empty list is true. **Fix:** read the statement periods from the `statements` table (migration 0002), use them for complete months and covered days, and treat "no spend accounts" as "no complete months".
4. **Question totals double-count.** One charge can be in a `business_or_personal`, a `one_off` and an `items` question at once, so summing `q.cents` overstates the total. **Fix:** count each charge once.
5. **Batch answers lose updates.** In `repo.tsx`, `answer()` builds on the `overlay` captured when the screen rendered. Calling it in a loop keeps only the last answer. **Fix:** an `answerMany()` that builds on the latest overlay and commits once.
6. **Price saving.** `prices.tsx` compares the most expensive store with the cheapest. **Fix:** move the logic to `core/prices.ts` and compare with the next cheapest.
7. **"Per year" for bills.** `yearCents` is spending over the past 12 months, not the yearly cost. **Fix:** use `monthlyCents × 12`.
8. **Unseen funding.** It must count card-side credits only. **Fix:** move the existing split from `accounts.tsx` into `core/accounts.ts` and use it in both places.

## 4. Shell, theme and system work (steps 2 to 4)

**Theme (step 2), whole app.**
- A `ThemeProvider` with `useTheme()`: follows the system setting, with a manual override saved in AsyncStorage.
- All 43 files move off `C`.
- `app.json` `userInterfaceStyle: automatic`; `StatusBar` follows the theme.
- Tokens exactly as in the brief. Today's values differ (light): ground `#F4F6FA` → `#F4F5FA`, ink2 `#444851` → `#464E5D`, line `#DDE1EA` → `#E4E7EF`, accent `#4356D4` → `#5264E6`. About 20 tokens are new.
- Card radius 12 → 22. Breakpoint 900 → 960.
- Fonts: Sora + Plus Jakarta Sans (replacing Bricolage Grotesque + Hanken Grotesk). Money uses `tabular-nums`.
- Logos: the SVGs already in `assets/brand/svg/`.
- `<PoweredBy />` is one component.

**Shell (step 3).**
- A top bar with Ask, the theme toggle, Inbox with its badge, the only Add button, and the avatar.
- A grouped sidebar (Workspace / Organize) with the statement footer. Add leaves the sidebar.
- Phone tabs: Dashboard, Explore, Add (floating button), Reports, Inbox.
- The routes the sidebar doesn't list stay reachable from the screens that link to them.
- `/views` is renamed "Tags overview", so it doesn't clash with dashboard views.

**Widget system (step 4).**
- A registry of the 22 widgets and the four exact presets.
- Migration `0008_dashboard_prefs.sql`:
  - `dashboard_widget_prefs (user_id, view, widget_id, enabled, position)`;
  - primary key `(user_id, view, widget_id)`;
  - CHECK constraints on `view` and `widget_id`;
  - RLS on `auth.uid() = user_id`.
- Saving writes the whole view, including `enabled = false` rows, so turning every widget off never falls back to the preset. Reset deletes only that user's rows for that view.
- Preferences belong to the signed-in person, even when an admin is viewing a member's data.
- The Customize drawer (desktop) and bottom sheet (phone) share their contents.

**Data (step 5).** The user's answers and edits live in the `overlays` JSON and are applied on the client, so a SQL view over `txns` would ignore them. So:
- `useDashboardData(month)` wraps `useRepo()`, with pure selectors in `src/core/dashboard.ts`;
- the only server reads added are the prefs table and the statement periods.

**Fixtures.** Fictional only, for tests and local development. They cover:
- full, partial and gapped statements;
- receipt lines at 2+ stores;
- unconfirmed deposits, one-offs;
- business income;
- unmatched card payments;
- bills seen once.

The app still never shows bundled data to a user.

## 5. Decisions

| Topic | Decision |
|---|---|
| Dark mode | Whole app. |
| Data layer | Client-side selectors over the effective ledger; no SQL aggregation views. |
| New view | Disabled with "Coming soon"; no `dashboard_views` table yet. |
| `/views` screen | Renamed "Tags overview", kept as a route, not in the sidebar. |
| Scope per view | Overview: all accounts. Household and Plan ahead: personal. Business: business. Pending amounts never join confirmed totals. |
| Forecast target | The month after the latest statement, labelled. |
| Readiness | The rules in section 2: no dollar thresholds, and a covered zero is Ready. |
| bizPL gate | A business income source with an attributed deposit, plus a month of business-tagged spend. No schema change. |
| Grocery | The brief's rule, matched by item name, compared with the next cheapest. No unit requirement (receipts store none). |
| Empty ledger | After a successful load, an empty ledger shows the dashboard with every widget locked. Sign-in, loading and error screens are unchanged. |

**Where the two audits disagreed:**
- **5% and 50% readiness thresholds** (Claude): dropped as arbitrary.
- **A history minimum for trend** (Claude): dropped; trend works with one month.
- **A history minimum for billsOnce:** kept at one complete month. Without it, every bill in a first month counts as "seen once".
- **Pack size and units for grocery** (Codex): not adopted, because receipts don't record them.
- **A new account field for business income** (Codex, first draft): withdrawn by Codex; the existing income sources cover it.
- **A SQL/RPC data boundary** (Codex, first draft): reduced to reading the statement periods.

## 6. What was added

Built on branch `dashboard-redesign`, one commit per step of the brief's section 9. After each step Codex reviewed it independently and read-only; every finding was either fixed or answered with a reason (see "Review record" below).

**Before → after**

| Area | Before | After |
|---|---|---|
| Dashboard | One fixed "Overview" screen: five cards, two charts, banners | Four views (Overview, Household, Business, Plan ahead), each with its preset, and all 22 widgets in the S / M / L grid |
| Widgets matching the design | 0 of 22 | 22 of 22, each with Ready, Needs your answers and Needs more data |
| Theme | Light only, fixed palette, Bricolage and Hanken | Light and dark from the brief's tokens, following the system or a saved manual choice; Sora and Plus Jakarta Sans; tabular figures |
| Shell | Tab bar drawn as a side bar | Top bar (Ask, theme, Inbox, the only Add, avatar), grouped side bar with statement status and PoweredBy, phone app bar and tab bar with a raised Add |
| Customize | None | 440px drawer (wide) and bottom sheet (phone); switches per widget with live readiness; Reset to default; choices saved per person and view |
| Saved choices | None | `dashboard_widget_prefs` (migration 0008), owner-only RLS, checked views and widgets, full snapshots so all-off stays off, kept on the device and resent until saved |
| Empty ledger | Full-page "Data is not available" | After a successful load, the dashboard with every widget locked and an Import action |

**Fixes to numbers that already existed** (section 3), each covered by a test:
- one recurring engine for the forecast, the Recurring screen and the dashboard;
- pace and averages leave out one-offs, and a large repeating bill (rent) is not a one-off;
- months are complete only where saved statements leave no gap;
- question totals count each charge once;
- "Mark all" and the Business or Personal buttons answer in one change;
- price savings are measured against the next cheapest store;
- yearly bills are monthly × 12;
- unseen funding counts card-side credits only.

**New files.** All of them are under `src/` except the migration, the scripts and the tests.
- `theme/`: `theme.tsx`, `contrast.ts`.
- `components/shell/`: `topbar`, `sidebar`, `phone`, `parts`.
- `components/`: `poweredby.tsx`, `brandsvg.ts` (generated by `scripts/brand-svg.js`).
- `dashboard/`: `catalog`, `views`, `layout`, `registry`, `frame`, `grid`, `header`, `customize`, `badge`, `money`, `useDashboardData`, and `widgets/` with one file per group.
- `core/`: `dashboard.ts`, `coverage.ts`, `prices.ts`.
- `charts/dash.tsx`.
- `data/dashboardPrefs.ts`.
- `dev/fixture.ts`: fictional ledgers for development and tests, loaded only in a development build with no backend and `EXPO_PUBLIC_FIXTURE` set.
- `supabase/migrations/0008_dashboard_prefs.sql`.
- Tests: `dashboard-layout`, `dashboard-prefs-rls`, `dashboard-data`, `contrast`.
- `scripts/fixture-readiness.ts`.

**Verification**
- `bun run lint`, `bun run typecheck` and `bun run test` pass: 363 passing and 2 skipped, against a baseline of 315 passing. The dashboard work adds 48 tests.
- `bun run build:web` exports.
- Checked in the browser with the fictional fixtures:
  - all four views, light and dark, at 360, 390, 960+, 1440 and 1600 px, with no horizontal page scroll;
  - the Customize drawer and sheet: switching, persistence across a reload, Reset;
  - the empty and sparse ledgers, so every locked state was seen;
  - Bills seen once and Mark all as business, which update every dependent widget and the forecast at once.
- Text contrast: every text and surface pair reaches 4.5:1 in both themes (`tests/contrast.test.ts`).
- Privacy: the branch history was scanned against the names and figures in `design-reference/`. The term list is kept outside the repo. Nothing matched beyond the brief's own category labels and month names.

**Open items**
- **Sparktrum logo:** not supplied yet. `<PoweredBy />` shows the text.
- **New view:** disabled with "Coming soon"; there is no `dashboard_views` table yet.
- **Migration 0008** was applied to the Supabase project on 2026-10-23, alone: a dry run confirmed it was the only pending one. The signed-in app reads the table (HTTP 200), and widget choices now sync.
- **Not run on a device:** native iOS and Android were not run here. The build is web-verified, and every component uses only cross-platform APIs.
- **Review record:** Codex reviewed each step. Its reviews found 37 issues, and all but four were fixed, each fix with a test where it is a number. The four counters, with reasons:
  - **Fuel does not react to every uncategorised question.** Nothing says which unknown charge is fuel. Codex accepted this.
  - **Streaming subscriptions are not listed as likely business tools.** A tool needs business evidence: the business hint, or an answer. Codex accepted this.
  - **Detected but unconfirmed bills do not mark the forecast "Needs your answers".** They prompt on Repeating bills and on Fixed bills vs everyday, where confirming them is the action. Otherwise the forecast would almost never be Ready.
  - **Spending by month: a refund larger than its category's purchases.** The bars show what was bought in each category, and the label shows the month's net total after refunds. In that rare case the bar can be taller than its label; Where it went states such a refund separately.

  Codex accepted the last two in its final pass. That pass found three more problems, which are now fixed:
  - a preference load that finished after a save could undo it;
  - the hero tile's chip and small text were below 4.5:1 (the chip is now darker, small text on the hero is white, and the contrast test composites the chip);
  - Fixed bills vs everyday's prompt had no action.

  Two items in Codex's final checklist could not be closed from the code alone:
  - **Native rendering on iOS and Android:** not run on a device here, as noted above.
  - **The privacy scan:** Codex could not repeat it, because the term list and `design-reference/` are outside the worktree on purpose. It is reproducible locally by grepping `git log -p main..dashboard-redesign` for the merchants and figures in `design-reference/`.
