# Finora dashboard — independent Codex audit and proposed plan

Date: 2026-10-22. Status: revised review draft after comparing both audits; no feature implementation authorized in this pass.

This is an independent assessment of `docs/FINORA_DASHBOARD_HANDOFF.md`, both local HTML references, and the current application source. The initial draft was written without reading `docs/dashboard-audit.md`; this revision incorporates the subsequent source-verified comparison. The other report remains unchanged. This separate filename preserves both proposals; after the plans are finalized, consolidate the accepted audit into the handoff's required `docs/dashboard-audit.md`.

## Privacy and scope

- `design-reference/` was already present in `.gitignore` before this audit. Neither reference file is tracked. Keep this rule; no duplicate ignore entry is necessary.
- `git log --all -- design-reference` was empty at comparison time. That verifies these paths have no reachable Git history; it does not prove their contents never appeared under other paths. A repository-wide privacy certification remains outstanding.
- Reference figures, account identifiers, merchant lists, and sample baskets are private. None are reproduced here. Reference HTML is design input, never application content or fixtures.
- This is a source audit, not a live Supabase inspection or a visual certification of the running app. Actual user readiness remains unknown until computed at runtime.
- No feature code, dependency changes, migrations, commits, or deployments are part of this pass.

## Findings at a glance

The current dashboard is `src/app/(tabs)/index.tsx`. It has seven cards: five financial/inbox cards corresponding to target widgets, and two navigation/Ask cards. It also has conditional data-quality banners. Of the 22 target widgets, **0 fully match, 5 exist but need changes, and 17 are absent from the dashboard**. Several absent widgets have reusable calculations or screens elsewhere; that does not make them implemented dashboard widgets.

All current dashboard cards use the single light palette in `src/theme/tokens.ts`; none implements the requested light/dark pair or the complete Ready / Needs your answers / Needs more data contract.

## Every existing dashboard card and notice

All entries below are in `src/app/(tabs)/index.tsx`, with primitives from `src/theme/ui.tsx` and charts from `src/charts/`.

| Current card/notice | Data and implementation | Theme support | Disposition |
| --- | --- | --- | --- |
| Headline receipt card | `summarize(ctx, range.from, range.to, scope)`; spent, earned, rewards, net; `TapeCard`; selected period and completeness label | Light only | Rebuild as `kpis`; four tiles, hero, previous comparable month change, earned confirmation chip, tabular money |
| Where it went | `categoryRows(ctx, scoped(range), 6)` and `HBars`; selected range and global scope | Light only | Rebuild as `donut`; fixed six-category mapping, all statement months, center total, amounts and one-decimal shares |
| Spending by month | `runQuery(spend, month, scoped())`; `Bars`; hatch when month end exceeds `completeTo` | Light only | Rebuild as `trend`; category stacks, selected outline, “so far”, average of complete months |
| Questions | All `questions`, count and sum of `q.cents`, Inbox button | Light only | Rebuild as `attention`; top three by amount and individual amounts; avoid implying overlapping question totals are unique spending |
| Forecast | `forecastMonth(ctx, fcMonth, dataTo)`; total, low/high, confidence, caveat; link to forecast route | Light only | Rebuild as `forecast`; visible range scale/band, readiness, link selects Plan ahead |
| Ask about your money | Static examples and `/ask` navigation | Light only | Move into shell Ask field; not one of the 22 |
| More | Static route links | Light only | Move access into shell/navigation; not one of the 22 |
| Receipts after statements notice and action | `links.receipts` with date after `dataTo`; `/links` action | Light only | Preserve honest evidence timing in shell/data-health context; receipts alone must not extend statement coverage |
| Incomplete income notice | `s.incomeIncomplete`, suppressed for business scope | Light only | Preserve warning with relevant KPI/cashflow context |
| Unconfirmed earned notice | `s.unconfirmedIncome` | Light only | Preserve and link directly to blocking deposit questions |
| PeriodBar | `period`, `range` and global `scope` from Repo | Light only | Move month/All selection into header; remove the old scope switch from dashboard |
| Partial-account notice | `s.partialAccounts`, coverage end dates | Light only | Integrate with coverage/partial-period messaging |

## Comparison with all 22 required widgets

“Missing” below means missing as a dashboard widget. Every row still ships, even when data is insufficient.

| # / ID / size | Current status | Reuse and required change |
| --- | --- | --- |
| 1 `kpis` L | Exists; changes | Headline + `core/queries.ts:summarize`. Four separate tiles; comparable prior-month delta; earned chip; rewards excluded from earnings. Never present partial spend as a completed monthly total. |
| 2 `cashflow` M | Missing | Summary supplies earned/spent/net/transfers. Add signed waterfall, confirmation note and excluded-transfer note; handle negative remainder and zero earned. |
| 3 `donut` S | Exists; changes | Existing category card uses horizontal bars and selected range. Extend `charts/stack.tsx:Donut` (already SVG arcs with gaps) for six fixed categories, all statement months, legend amount and share. |
| 4 `trend` M | Exists; changes | Existing monthly bars are single-series. Extend `charts/stack.tsx:StackBars` plus `charts/common.tsx:HatchDefs`; add hatched stacks, stable category colors, selected outline and complete-month mean. |
| 5 `oneTime` S | Missing | `Txn.oneOff`, `core/questions.ts`, `core/answers.ts` and forecast exclusions exist. Add share ring, largest confirmed one-off and adjusted total. Distinguish candidates from answers. |
| 6 `cutIdeas` M | Missing | Compose receipt comparisons, eligible active recurring monthly equivalents × 12 (not historical `yearCents`), unsplit big-box spend, and adjacent full-month category change. Max four actual rules; hide unavailable rules, never invent zero savings. |
| 7 `fixedFlex` S | Missing | `core/recurring.ts:summarizeRecurring`, complete-month spend and forecast variable calculations are useful. Unify basis first; add ring and missing housing/utilities warning. Built-in housing/utilities categories are absent: add explicit category support or an explainable mapping respecting custom categories. |
| 8 `subscriptions` S | Missing | Recurring route/engine and saved recurring state exist. Render sorted merchant bars, monthly/yearly equivalents, confirmation prompts. |
| 9 `grocery` S | Missing | `prices.tsx` compares normalized item text across stores. Extract pure comparison logic, require comparable quantities/units, compare cheapest with NEXT cheapest (current screen uses most expensive), enforce three qualifying items. |
| 10 `bigbox` S | Missing | Category/merchant queries and receipt links exist. Define store grouping independently of receipt item recategorization; split by store, percentages, add-receipt action. |
| 11 `fuel` S | Missing | Spend queries + `Bars` reusable. Add spent/fill-up count/average, monthly hatching and top station share; exclude refunds from fill-up count. |
| 12 `forecast` S | Exists; changes | Current forecast includes range and confidence in text. Add range graphic, complete-data gate, answer dependencies and Plan ahead selection action. |
| 13 `forecastBuild` M | Missing | `forecast.tsx` already displays recurring, variable category estimates and excluded one-offs in separate cards. Compose split bar plus one-off and seen-once scenario tiles; use same model as forecast. |
| 14 `pace` M | Missing | `Forecast.pace` is a numerical estimate, not a cumulative chart; `charts/lines.tsx` offers reusable rendering. Add daily cumulative series, forecast line and seven recorded-day coverage gate. |
| 15 `billsOnce` S | Missing | Large-one-off Inbox questions and recurring manual edits are partial building blocks. Add seen-once bill candidates, paired decisions and persisted recurring inclusion that immediately changes forecast. |
| 16 `bizSummary` L | Missing | `core/income.ts:attribute` and `summarizeIncome` already attribute deposits to `IncomeSource.type === business`; reuse alongside business spend, pending questions and recurring output. Add four tiles and verify income/account connection for the disconnected CTA. |
| 17 `bizPending` M | Missing | Business/personal questions, `applyAnswer`, merchant rules and Repo answer API exist. Add merchant totals and bulk merchant actions; use atomic updates to avoid stale overlay overwrites. |
| 18 `bizDonut` S | Missing | Pending question transaction IDs and merchants supply source rows. Add donut from unresolved charge set, deduplicated amounts, stable merchant colors. |
| 19 `bizTools` S | Missing | Recurring output and business hints available. Add explainable software/tool candidate classifier, monthly/yearly totals and atomic “Mark all as business”. Never count “likely” as confirmed business. Keep confirmed business tools visible; act only on undecided candidates and respect explicit Personal answers. |
| 20 `bizPL` M | Missing | Reuse business spend queries and existing income-source/deposit attribution. A source record alone does not prove an account is connected. Verify its relationship to a connected account; add mapping metadata only if existing evidence is insufficient. Gate on connected business-income account plus at least one month with tagged spend. |
| 21 `attention` S | Exists; changes | Questions card and amount-ranked `buildQuestions` reusable. Top three with amounts, open count, relevant Inbox links, successful zero-question state. |
| 22 `dataHealth` S | Missing | `accounts.tsx` already shows coverage tracks and unmatched card payments. Extract calculations; hatch uncovered segments, expose statement gaps, account coverage and unseen funding warning. Count unmatched card-payment credits on credit accounts for unseen funding; bank-side unmatched withdrawals have a separate missing-card-statement meaning. |

## Three-state contract for every widget

Proposed semantics: compute evidence and blockers per widget, not a global dashboard badge. If minimum evidence is absent, show **Needs more data** with a dashed ghost, specific missing evidence and one unlocking action. Otherwise, if an unanswered question materially affects the widget, show **Needs your answers** with the provisional chart/list and a link to those Inbox questions. Otherwise show **Ready**. Loading, sync failure, and an inaccessible workspace are separate operational states, not fake missing data.

The brief specifies hard thresholds only for grocery, pace, and business P&L. Other minimums below are proposed implementation rules for review. Do not fabricate questions merely to exercise a state. The components must support all three states, with fictional fixtures validating each; actual labels follow real dependencies. A valid zero result is Ready when coverage supports it.

| Widget | Ready evidence/output | Needs your answers trigger | Needs more data and unlocking action |
| --- | --- | --- | --- |
| `kpis` | Covered selected period and calculated four tiles; zero valid | Unconfirmed deposits or unresolved classification affecting totals | No statement-backed period → import statement |
| `cashflow` | Period income/spend/transfers computable | Deposit/ownership answers affect flow | No covered period → import statement |
| `donut` | Statement-backed category spend; truthful empty state if zero | Category/item/business classification changes slices | No statement data → import statement |
| `trend` | At least one covered month; average omitted with explanation if no full months | Relevant category/ownership classification | No covered months → import statement |
| `oneTime` | Covered spending, confirmed one-off share (including zero) | Unanswered one-off candidates | No statement-backed spend basis → import statement |
| `cutIdeas` | At least one eligible computed rule | Relevant bill/item/category answers affect available rules | No eligible rule → import comparable receipts or statements, choose one relevant action |
| `fixedFlex` | At least one full month for everyday mean and computable recurring basis | Recurring/one-off decisions alter split | No full month → import statements; housing warning remains independent |
| `subscriptions` | Recurring history or explicit saved bills; covered zero can be empty | Detected repeating bills await confirmation | Insufficient history and no explicit bills → add bill/import statements |
| `grocery` | At least three comparable items each priced at two stores | Relevant receipt/item ambiguity is awaiting an existing question | Below hard threshold → add receipts |
| `bigbox` | Covered store spend; covered zero is empty | Existing missing-item/store questions affect detail | No covered purchase basis → import statement |
| `fuel` | Covered fuel purchases, or covered zero empty state | Unresolved fuel categorization | No covered purchase basis → import statement |
| `forecast` | At least one full historical month, range and confidence | Pending one-off/recurring/scope decisions affect forecast | No full basis month → import statement |
| `forecastBuild` | Same basis as forecast with reconciling components | Same blockers plus seen-once decisions | No full basis month → import statement |
| `pace` | At least seven days recorded by statement coverage and forecast basis | Relevant current-month classifications | Fewer than seven covered days or absent forecast basis → import needed statement |
| `billsOnce` | Candidate detection ran on covered history; resolved empty is valid | Seen-once candidates await repeats/one-time decisions | No useful bill history → import statement |
| `bizSummary` | Business spend/pending/tools computable; disconnected income remains a tile-level CTA | Unanswered business/deposit classifications | No statement-backed business context → import/connect account |
| `bizPending` | Question scan complete; zero pending is success | Business/personal questions exist | No statement-backed charges → import statement |
| `bizDonut` | Pending set computable; zero unresolved is success | Pending business/personal charges exist | No statement-backed charges → import statement |
| `bizTools` | Recurring tool candidates or covered empty result | Candidate business classifications unconfirmed | No recurring basis → import additional statements |
| `bizPL` | Business-income account plus at least one month tagged business spending | Income/business answers affect available series | Either hard requirement missing → connect/designate income account or classify spend, one targeted action |
| `attention` | Questions scan available; zero open is success | Blocking classifications make displayed impacts provisional | No imported source to scan → import statement |
| `dataHealth` | Accounts and statement intervals available | Ownership questions affect unmatched-funding warning | No account/statement coverage → connect/import account |

Do not add the other proposal’s 5% category or 50% unconfirmed-bill thresholds: readiness follows material dependencies, not arbitrary amount cutoffs. Do not require two months for trend, a full month for fuel, or two complete months before asking about a bill seen once. Covered partial actuals remain useful when labelled. No detected spend or recurring items can be a valid empty result when sufficient evidence supports it.

The attention widget can be Ready while showing open questions: its job is to report them. Pending-business widgets generally remain Needs your answers while actionable rows remain. Badge meaning must describe the widget's dependencies consistently, not mechanically mark every widget with any Inbox question.

## Data and architecture gaps to resolve before charts

1. **Effective ledger is the source of truth.** `data/repo.tsx` combines workspace data, overlays, receipt links and tags before exposing `ctx`. SQL aggregating raw `txns` alone would disagree with current answers and edits. Propose `useDashboardData(month)` wrapping `useRepo()` with pure selectors in `src/core/dashboard.ts`. Reuse the existing effective ledger rather than introducing parallel SQL aggregation. Load statement intervals through existing evidence access where possible; add an authorized query/RPC only for a demonstrated retrieval or performance need. This client-side aggregation is a proposed adjustment to the handoff’s SQL-backed hook, to be accepted during plan finalization. Validate agreement with drill-down rows.
2. **Recurrence has two engines.** `core/forecast.ts` detects stable monthly merchants independently; `core/recurring.ts` handles cadence, manual bills and saved confirmations/cancellations. Forecast does not consume saved recurring state; contrary to the other report, a manual “Repeats monthly” decision does not already update both engines. `items[].yearCents` is recorded spending over the preceding year (zero for manual bills), not the current annual equivalent. Compute annual equivalents from eligible active monthly amounts × 12 and consistently exclude ignored/cancelled/stopped items. Consolidate the input/output contract so decisions in billsOnce, subscriptions and Inbox recalculate all forecasts once, without double counting.
3. **One-off semantics differ.** Forecast currently excludes marked one-offs AND large unconfirmed candidates automatically. Its target-month pace uses spending including one-offs. Separate confirmed exclusions, provisional candidates and scenario amounts; ensure one-off exclusion is consistent in averages and forecast/pace calculations. Keep historic trend actual spend visible.
4. **Coverage is currently an envelope.** Account `coverage.from/to` and `completeTo` cannot prove there are no internal missing statement intervals. Use `statements` intervals (`0002_evidence.sql`) to derive full months and recorded-day counts. An account with zero transactions may still have complete statements. No accounts must not pass an `every()` completeness test vacuously.
5. **Partial periods remain actual-to-date.** Hatching and “so far” apply wherever partial actuals appear. Do not extrapolate or compare them as full-month totals; full-month means exclude partial periods and confirmed one-offs. KPI prior-month change should be unavailable with an explanation when periods are not comparable.
6. **Reuse business-income attribution before extending the schema.** `core/income.ts` already has business sources, manual deposit assignments, pay-record matching and `attribute()` / `summarizeIncome()`. My initial draft overstated the need for a new account field. Use existing attribution to compute actual business deposits, separately from gross pay-record values. A source can exist without any connected account or deposit, so validate the account relationship and coverage; add explicit mapping metadata only where the existing model cannot represent that relationship. Preserve ownership checks. A missing income connection must not turn P&L into a false loss.
7. **Receipt comparison needs comparability.** Current prices screen averages `line.cents` by item text and compares cheapest to most expensive. Require known comparable pack size/quantity/unit/currency; do not infer unit price from a line total. Preserve provenance and lock when evidence is inadequate. Cheapest-per-item basket and cheapest single store for a whole basket are different; the latter requires common-basket coverage and must not sum unrelated minima.
8. **Bulk updates must be atomic.** Repo's `answer` closes over an overlay; repeated answers in a loop can overwrite each other. Provide one batch overlay mutation with rollback/error behavior for merchant and mark-all actions. Answers invalidate related selectors immediately, then sync.
9. **Preferences are new.** No dashboard widget registry, presets, Customize UI or dashboard preference migrations exist. Add `(user_id, view, widget_id)` uniqueness, allowed IDs/views, deterministic position ordering, owner RLS for read/write/delete and indexes. Save a full view snapshot transactionally; preserve all-off via explicit disabled rows so it cannot look like “no rows, use preset.” Reset deletes only the selected user's selected view. Cache keyed by user/view; clear on sign-out/user switch and surface save failures.
10. **Preserve workspace boundaries.** Current Repo supports individual and combined team views. Data access follows existing workspace permissions; widget preferences remain per authenticated user. Never aggregate other users merely because a caller supplies an ID. SQL views/RPCs must preserve RLS and existing member restrictions; test cross-user access.
11. **Unseen funding warnings must distinguish transfer sides.** Reuse `accounts.tsx` logic separating unmatched credit-account payments from unmatched checking-account withdrawals. Do not sum both sides as unseen funding or double count movements. Coverage must come from intervals, not transaction activity.
12. **The empty-data gate currently prevents dashboard readiness states.** `src/app/_layout.tsx:Gate` replaces every route except import/people with `NoData` when there are no accounts. Proposed behavior: after successful authenticated loading, allow the dashboard and shell to render locked widgets for an empty ledger; retain separate sign-in, loading and error states. Never substitute fictional fixture data for a user’s empty database. Accept this onboarding adjustment explicitly during plan finalization.
13. **Month and view are distinct.** The old Everything/Personal/Business switch must not leak into the new dashboard. Business view filters business data; pending amounts remain separate from confirmed totals. Existing `/views` is overlapping tag analysis, not the four dashboard presets. Proposed default: Overview uses all visible accounts; Household/Plan use personal scope; all-history widgets retain their specified range. Confirm this during plan comparison rather than silently inheriting persisted global scope.

## Reference interpretation and shell work

- Use Main's spacing, radii, typography, drawer geometry and both theme palettes. Rebuild charts with existing `react-native-svg`, never ship HTML or CSS gradients. Reuse `charts/stack.tsx:Donut` and `StackBars`, `charts/bars.tsx:Bars` / `HBars`, `charts/common.tsx:HatchDefs` and `charts/lines.tsx`. Existing components still need theme-aware colors, required gap sizes, hatching/selection/mean features and accessible numeric summaries; their presence does not make the widgets complete.
- Phone reference is an abbreviated composition with fewer widgets and shorter lists. It does not reduce scope: the same registry, all 22 widgets and full presets run on phone, stacked in one column. Phone Customize is a bottom sheet reusing drawer contents.
- Written requirements win where the mockup diverges: fixed category colors, navy single-series charts, 0.6–1% donut gaps, one-decimal category shares, actual adjacent-month rise rule, and computed readiness. Do not port hard-coded reference readiness or figures.
- `app.json` currently forces `userInterfaceStyle: light`, and `src/app/_layout.tsx` forces `StatusBar` to dark. Step 2 must address both and migrate all affected screens, shared primitives and chart consumers of the fixed light palette. Merely theming the dashboard would leave linked screens inconsistent.
- Current theme is static, uses different fonts, radius 16 and breakpoint 900. Target is Sora/Plus Jakarta Sans, radius 22, breakpoint 960, persisted system/manual theme and max content width 1280. Brand SVG assets requested by the brief already exist in `assets/brand/svg/`.
- Current phone tabs include Accounts and place Inbox before Reports; desktop also exposes Add in sidebar. Replace with requested shell: single desktop Add, grouped sidebar, phone Dashboard/Explore/Add/Reports/Inbox, retained access to existing detail routes.
- Keep a shared `PoweredBy` text component pending Sparktrum art. Proposed first release: disabled New view with accessible “Coming soon” explanation; defer `dashboard_views` unless custom views are selected for scope. This does not defer any widget.

## Proposed implementation sequence — handoff section 9

### 1. Privacy and accepted audit

Keep ignore rule, verify both refs remain untracked, compare independent proposals and consolidate the agreed audit. No feature coding before this review. Final privacy checks should scan staged content and history locally without copying private search strings/results into docs or logs. Current ignore verification is not a certification that all past history is clean.

### 2. Theme, fonts and brand

Read Expo package version (currently major 58) and fetch matching versioned docs before any Expo/React Native API edits. Follow `llms.txt` for specific routing/platform docs. Add fonts only via `bunx expo install`; retain Bun as the sole lockfile. Implement semantic theme provider/tokens, system preference and persisted override, shared brand variants and PoweredBy. Replace static token reads across affected screens, shared primitives and charts. Configure system appearance and a theme-aware status bar using verified SDK documentation; keep fonts loaded at the root and money tabular. Dark mode must work when following dashboard links, not just on the dashboard.

### 3. Responsive shell

Build top bar, grouped sidebar, mobile app bar/Ask field, four view chips with descriptions, statement-backed month selector and bottom tabs. Keep screens as routes under `src/app/`; reusable shell/widgets stay outside it. Cover safe areas, keyboard, drawer/sheet focus, 44px controls, 360–1600px widths and the 960px switch. Implement the agreed empty-ledger dashboard behavior without changing authentication or substituting samples. Preserve access to existing tag-based `/views` (proposed label: “Tags overview”) and other detail screens even if removed from the new sidebar.

### 4. Registry, presets and Customize

Create a typed 22-ID registry, grouped metadata, default sizes and exact ordered presets. Build drawer/sheet from shared content with live readiness badges. Add Supabase preference migration/RLS and transactional persistence, fallback/reset/all-off behavior, rollback/retry and per-user caches. Widgets added outside the preset append in saved order at default size. Sizes come from presets/defaults; arbitrary size editing is not requested.

Exact presets:

- Overview: `kpis L, cashflow M, donut S, trend M, forecast S, oneTime S, attention S, dataHealth S`.
- Household: `cutIdeas M, fixedFlex S, trend M, subscriptions S, grocery S, bigbox S, fuel S`.
- Business: `bizSummary L, bizPending M, bizDonut S, bizTools S, bizPL M`.
- Plan ahead: `forecast S, forecastBuild M, pace M, billsOnce S, subscriptions S, oneTime S, fixedFlex S`.

### 5. Unified dashboard data

Implement `useDashboardData(month)` over Repo with pure memoized selectors in `src/core/dashboard.ts` for effective ledger, statement intervals, confirmed/pending classifications, unified recurrence, one-offs, comparable prices and existing business-income attribution. Reuse evidence retrieval; introduce SQL/RPC work only for demonstrated needs, alongside the required preference migration. Verify connected business-income evidence before deciding whether a mapping extension is necessary. Preserve integer cents and transaction provenance. Define all readiness predicates before widgets. Add fictional local fixtures with full/partial/gapped statements, sparse receipts, unconfirmed deposits, one-offs and business states. Do not derive fixtures from reference values.

### 6. All 22 widgets, in required group order

Build Big picture (1–5), Save money (6–11), Plan ahead (12–15), Business (16–20), then Keep it accurate (21–22). Each widget's delivery includes its three state renderers, computation, real action, accessibility numbers, both themes and phone/web layouts. Shared chart primitives should cover signed waterfall/P&L, gapped arcs, category stacks, ranges, cumulative pace and hatched coverage. Retain no-data widgets rather than omitting them. Keep financial derivation outside components.

### 7. Verification and completion

Use existing Bun/TypeScript test infrastructure and PGlite SQL/RLS helpers. Validate preset fallback, ordered toggle persistence, all-off/reset isolation, cross-user RLS, save failures and sign-out cache isolation. Table-test readiness, grocery 2-versus-3 threshold, pace 6-versus-7 covered days, P&L gates, zero-data versus valid-zero, refunds, transfer pair exclusion, rewards separation, one-off exclusion, gapped/partial periods, and `low <= total <= high` forecast invariants. Verify bill/business answers change dependent charts without reload and don't lose edits. Test current annual equivalents against short histories/manual bills, next-cheapest comparable basket pricing, both unmatched card-payment sides, confirmed tool retention and explicit Personal exclusions. Verify a source without connected-account evidence does not unlock business P&L, and a successfully loaded empty ledger can reach locked dashboard widgets.

Review all 22 × three states × two themes on phone and web with fictional data, including long labels and negative balances; check contrast, touch targets, screen-reader chart summaries, focus/dismiss behavior and no horizontal overflow. Run `bun run lint` and `bun run typecheck`; run relevant tests and web export after implementation. Update accepted audit with what was added and actual validation evidence. No real personal figures enter committed snapshots.

## Decisions to resolve when comparing plans

1. Accept deferring custom views behind disabled New view, or include creation/persistence now?
2. Confirm all-account Overview versus personal Household/Plan scope and the intended forecast target when an older month or All is selected. Proposed forecast target remains next month after latest statement coverage; the label always makes the target explicit.
3. Approve the proposed readiness minimums where the brief does not define a threshold, especially recurring history, attention semantics and partial-month KPI comparison.
4. Accept client-side aggregation over Repo, with additional evidence retrieval only where needed, rather than requiring new SQL aggregations for dashboard totals?
5. Accept letting a successfully loaded empty ledger reach the dashboard’s locked widgets while preserving authentication/loading/error handling?
6. Confirm the business-income account-link evidence needed beyond existing source attribution; add metadata only if necessary.
7. Supply Sparktrum logo when available; plain text is explicitly acceptable meanwhile.

## Comparison verdict and revision record

Both audits agree on the inventory and all-22 scope. Keep the other report’s explicit reuse map, theme configuration blockers and housing/utilities gap. Keep this report’s effective-ledger consistency, statement-gap coverage, atomic updates, preference edge cases and verification matrix. Correct recurring-to-forecast integration, annual equivalents, transfer-side warnings, business connection gates, receipt comparability and readiness semantics before implementation.

This revision corrects my initial omission of existing business-income attribution and makes chart reuse explicit. It removes the assumption that a new business account field/migration or dashboard aggregation RPC is automatically needed. No feature code has been written, and the other audit remains unchanged. Neither report alone certifies live readiness, visual quality or repository-wide privacy.

These decisions do not justify reducing the 22-widget scope. Feature implementation waits for the user's comparison/finalization of plans.
