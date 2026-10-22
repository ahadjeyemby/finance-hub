# Finora dashboard: implementation handoff

For: Claude Code, working in `ahadjeyemby/finance-hub` (Expo for mobile and web, Supabase backend).
From: the "Finora Final Design" canvas (12 screens: 4 dashboard views in light and dark, the Customize panel in light and dark, the phone dashboard in light and dark).

Reference files that come with this brief:
- `design-reference/Main.dc.html`: the desktop dashboard. It contains every widget, the view tabs, the Customize drawer, all theme tokens and the chart maths in the `renderVals()` script. Treat it as the exact source for spacing, radii, font sizes and colors.
- `design-reference/Phone.dc.html`: the phone dashboard.

Both are HTML mockups. Do not ship them, and do not port their CSS one to one: rebuild in React Native components (see section 7).

---

## 0. Before writing any code: audit what exists

1. List every dashboard widget/card the app has today: its file, what data it reads, and whether it supports light and dark.
2. Compare that list with the 22 widgets in section 5, and report back:
   - widgets that already exist and match the design,
   - widgets that exist but need changes (say what),
   - widgets that are missing.
3. **The current list is expected to be much shorter than the design. Build all 22.** Don't stop at what exists, merge widgets or drop the ones whose data is thin. A widget without enough data ships with its locked state (section 4), not left out.
4. Write the audit to `docs/dashboard-audit.md` before starting step 1 of the build order (section 9).

## 1. Privacy rule (blocking)

The repo will be open source, with only fictional sample data in it.

- **The two reference HTML files contain real personal figures and merchant names. Never commit them.** Put them in a gitignored folder (for example `design-reference/`) and add that folder to `.gitignore` before doing anything else.
- Fixtures, seeds, Storybook stories and tests must use **fictional** merchants and amounts. Do not copy any number or name from the reference files into the repo.
- Live numbers come only from the user's Supabase data at runtime.

## 2. Brand and theme tokens

Fonts (Google Fonts, load with `expo-font` / `@expo-google-fonts`):
- Display and numbers: **Sora** 600 and 700.
- UI and body: **Plus Jakarta Sans** 400, 500, 600 and 700.
- All money uses tabular figures (`fontVariant: ['tabular-nums']`).

Logos come from the Finora brand pack (`Finora_Brand_Assets`):
- Light mode: `01_symbol_color.svg` + `05_wordmark_dark.svg`.
- Dark mode: `04_symbol_reversed.svg` + `06_wordmark_white.svg`.
- Render them with `react-native-svg` (`SvgXml`) or a transformer. In the header the mark is 44px and the wordmark is 104×27.
- **Sparktrum logo: pending.** The user still has to supply the file. Until then, the sidebar footer and the phone footer show the text "Powered by Sparktrum". Leave a single `<PoweredBy />` component so the logo swaps in at one place.

Tokens (copy into `theme/tokens.ts`; every component reads tokens, never hex):

| Token | Light | Dark | Use |
|---|---|---|---|
| ground | #F4F5FA | #0D1320 | page background |
| side | #FFFFFF | #111827 | sidebar |
| paper | #FFFFFF | #151D2D | cards |
| field | #FFFFFF | #1B2538 | inputs |
| seg | #EEF0F5 | #1E2738 | segmented control, neutral chips |
| ink | #172031 | #EEF1F7 | main text |
| ink2 | #464E5D | #B8C0CF | secondary text |
| ink3 | #5E6676 | #97A1B3 | captions (still passes 4.5:1) |
| line | #E4E7EF | #253048 | card borders, dividers |
| line2 | #CDD3DF | #3A4762 | stronger borders, empty-state dashes |
| accent | #5264E6 | #8A97FF | primary buttons, selected state |
| onAccent | #FFFFFF | #0D1320 | text on accent (dark mode uses dark text: white fails contrast) |
| accentInk | #3B4BC8 | #AEB7FF | links, active nav text |
| accentSoft | #ECEEFD | #232D52 | active nav background, soft chips |
| hero | #5264E6 | #4C5BD8 | filled hero card (white text) |
| heroSoft | #DCE0FB | #D6DAFA | secondary text on hero |
| cta | #172031 | #EEF1F7 | avatar background |
| warnBg / warnInk | #FFF1CC / #6B4A00 | #3A2F10 / #F5D88A | warnings, "Needs your answers" |
| good / goodInk / goodSoft | #1A9C6C / #137A54 / #DDF3EA | #4FD1A1 / #6FE0B5 / #173A30 | positive values, "Ready" badge |
| inn / out | #1A9C6C / #E8743B | #3FBF8C / #F08A55 | money in / money out in the waterfall |
| flexC | #C9CFDD | #3B4A6B | "everyday" segment |
| bar | #2E3A5C | #AAB4CC | single-series bars |
| track | #EDF0F5 | #232D42 | bar and ring tracks |
| range | #C3CAF7 | #4A5BD0 | forecast range band |
| scrim | rgba(23,32,49,.35) | rgba(5,8,15,.6) | behind the Customize drawer |

Category colors (in this order; fixed per category everywhere, never reassigned):
- Light: Travel #E8743B, Big-box #0F8F79, Groceries #7DB83A, Fuel #E0A800, Medical #D9578A, Everything else #8A93A6.
- Dark: #F08A55, #2BBBA2, #93CC52, #F2C23A, #E9779F, #6F7A8E.

Color rule: the brand blue (accent) is for actions, links and the selected state. Charts use the category palette, or navy `bar` for single-series bars, so charts and buttons never look alike.

Shape and size:
- Cards: radius 22, 1px `line` border, padding 22.
- Inner tiles: radius 12 to 16.
- Every touch target at least 44px.

## 3. Layout

**Desktop/web (≥ 960px):**
- **Top bar.** Logo; the "Ask about your money" search with an Ask button; theme toggle; Inbox with a count badge; Add (primary); avatar. It is the only Add button. Don't add a second one in the sidebar.
- **Sidebar (232 to 256px).**
  - Workspace: Dashboard, Explore, Inbox, Reports, Accounts.
  - Organize: Receipt links, Recurring, Income, People, Categories and tags.
  - Footer: "Statements through <date>" with a status dot, the workspace/avatar row, then `<PoweredBy />`.
- **Main (max width 1280).**
  - Eyebrow "Your money, a little clearer.", then H1 "Dashboard" (Sora 40).
  - Right side: month segmented control (months that have statements + "All") and a "Customize" button.
  - View tabs: Overview, Household, Business, Plan ahead, plus a dashed "New view" button. Under the tabs, a one-line description of the selected view.
  - Widget area: a wrapping row with gap 20. Sizes: S = flex 1 1 300, M = flex 2 1 600, L = 100% width.
- The old Everything/Personal/Business scope switch is removed. The Business view replaces it.

**Phone (< 960px):**
- App bar: logo, theme toggle, avatar.
- Ask field.
- "Dashboard" title + Customize button.
- View chips (horizontal scroll), with the view description under them.
- Widgets stacked one per row.
- Bottom tab bar: Dashboard, Explore, Add (floating action button), Reports, Inbox (badge).

**Customize drawer:**
- Desktop: a right-side drawer, 440px wide, over a scrim.
- Phone: a bottom sheet. This isn't in the design yet, so reuse the drawer's content.
- Title "Customize <view>", with the line "Turn widgets on or off for this view. Each view keeps its own set. N of 22 on."
- Widgets grouped (section 5). Each row shows an icon, name, chart type, a readiness badge and a switch (`accessibilityRole="switch"`).
- Footer buttons: "Reset to default" and "Done".

## 4. Widget system (architecture)

Build a registry, not hard-coded screens:

```ts
type WidgetSize = 'S' | 'M' | 'L';
type Readiness = 'ready' | 'answers' | 'data';   // labels: Ready / Needs your answers / Needs more data
interface WidgetDef {
  id: WidgetId;
  name: string;
  group: 'Big picture' | 'Save money' | 'Plan ahead' | 'Business' | 'Keep it accurate';
  chartKind: string;          // shown in the drawer: Donut, Ring, Waterfall, Stacked bars…
  defaultSize: WidgetSize;
  readiness: (data: DashboardData) => Readiness;   // computed from live data, not hard-coded
  Component: React.FC<{ data: DashboardData; size: WidgetSize }>;
}
```

- **View presets.** Ordered `[id, size]` lists, defined in code:
  - overview: kpis L, cashflow M, donut S, trend M, forecast S, oneTime S, attention S, dataHealth S
  - household: cutIdeas M, fixedFlex S, trend M, subscriptions S, grocery S, bigbox S, fuel S
  - business: bizSummary L, bizPending M, bizDonut S, bizTools S, bizPL M
  - plan: forecast S, forecastBuild M, pace M, billsOnce S, subscriptions S, oneTime S, fixedFlex S
- **Per-user state in Supabase.** Table `dashboard_widget_prefs (user_id, view, widget_id, enabled, position)`, protected by RLS on `user_id`.
  - If a view has no rows, use the preset.
  - "Reset to default" deletes that view's rows.
  - A widget turned on outside its preset goes after the preset widgets, at its default size.
- **Custom views.** "New view" creates a row in a `dashboard_views` table (name, icon, widget set). If this is too much for the first pass, ship the button disabled with a "Coming soon" tooltip, and say so in the audit.
- **Readiness states. Every widget implements all three:**
  - **Ready:** the full chart.
  - **Needs your answers:** the chart is shown with an inline prompt that links to the Inbox questions blocking it.
  - **Needs more data:** a dashed "ghost" chart with a centered card saying what's missing and the one action that unlocks it. See `pace` and `bizPL` in `Main.dc.html`.
- Never show a single forecast number without its range, and never total a partial month.

## 5. The 22 widgets

The data each widget needs is listed so you can map it to existing Supabase tables and views, or add SQL views/RPCs where none exist.

### Big picture
1. **kpis: Month at a glance** (L, Numbers). Four tiles:
   - Spent (hero tile, with change vs the previous month).
   - Earned (shows a "Not confirmed yet" chip until the deposits are confirmed in the Inbox).
   - Left after spending (earned minus spent).
   - Rewards (kept apart from earnings).

   Data: monthly totals, confirmed flag on deposits, rewards.
2. **cashflow: Money in vs out** (M, Waterfall).
   - Bars: Earned rising from 0, Spent as a floating bar coming down from the Earned total, Left as the remainder.
   - Notes beside the chart: earned confirmation status, and "Not counted: $X of card payments and transfers".

   Data: selected month's earned, spent, transfer total.
3. **donut: Where it went** (S, Donut).
   - Six category slices with small gaps, total in the center, and a legend with amount and % (one decimal).
   - Range: all months with statements.
4. **trend: Spending by month** (M, Stacked bars).
   - Category stacks per month; the selected month is outlined.
   - Partial months are **hatched** and labelled "so far".
   - A dashed line shows the average of full months only.
5. **oneTime: One-offs vs normal months** (S, Ring).
   - The ring shows the share of spending flagged one-time, with the largest one-off named.
   - Shows the total without one-offs.

   Data: transactions flagged one-time (the existing "one-time trip?" question).

### Save money
6. **cutIdeas: Where you could spend less** (M, List). Rules-based, every figure computed from real purchases, nothing estimated:
   - (a) The cheapest store for the user's usual basket, with the saving per basket. Uses receipt line-item prices; needs the same item at two or more stores.
   - (b) Total of repeating bills per year.
   - (c) Big-box spend with no item detail.
   - (d) The biggest month-over-month rise in a category.

   Show at most 4. A rule with no data is hidden; it never shows a zero.
7. **fixedFlex: Fixed bills vs everyday** (S, Ring).
   - Repeating bills vs everyday average.
   - Warning when no housing, rent or utility bills are detected ("If they're paid from an account Finora can't see, this split is off").
8. **subscriptions: Repeating bills** (S, Bars). One bar per repeating merchant, sorted, with monthly and yearly totals. Data: the recurring-detection output.
9. **grocery: Cheapest store for your basket** (S, Table).
   - Item, cheapest store and price, saving vs the next cheapest; footer with the saving per basket.
   - Locked ("Needs more data") until 3 or more items have prices from 2 or more stores.
10. **bigbox: Big-box stores** (S, Split bar). Split by store with amounts and %, and a CTA to add receipts so the spend can be split by item.
11. **fuel: Fuel** (S, Bars).
    - Stats: spent, fill-ups, average fill-up.
    - Monthly bars, partial month hatched.
    - Top station share.

### Plan ahead
12. **forecast: Next month forecast** (S, Range).
    - Best guess, a range band on a 0 to max scale, and a confidence chip.
    - Link that switches to the Plan ahead view.
13. **forecastBuild: What next month is made of** (M, Split bar).
    - Repeating vs everyday average.
    - "Left out on purpose" tile (one-offs).
    - "If the bills seen once repeat, next month rises to about $X".
14. **pace: Month pace** (M, Line).
    - The month's cumulative spending line against a straight forecast line.
    - "Needs more data" until 7 days of the month are recorded.
15. **billsOnce: Bills seen once** (S, List).
    - Each bill has "Repeats monthly" and "One-time" buttons.
    - The answer updates recurring detection and the forecast.

### Business
16. **bizSummary: Business at a glance** (L, Numbers). Four tiles:
    - Tagged as business.
    - Waiting for your answer.
    - Likely business tools per month.
    - Business income (a "Not connected" tile with a CTA when there is none).
17. **bizPending: Business or personal?** (M, List).
    - Merchants with unanswered business/personal questions, with their totals.
    - Business and Personal buttons write the answer for every charge from that merchant.
18. **bizDonut: Waiting, by merchant** (S, Donut). The unanswered amount split by merchant.
19. **bizTools: Software and tools** (S, List).
    - Repeating software charges that look like business, with monthly and yearly totals.
    - "Mark all as business" button.
20. **bizPL: Business profit and loss** (M, Bars).
    - Business income minus business spending, per month.
    - "Needs more data" until a business income account exists and at least one month has tagged business spending.

### Keep it accurate
21. **attention: Needs your attention** (S, List).
    - Open question count, and the top 3 by amount, each with its amount.
    - Primary "Answer questions" button.
22. **dataHealth: Data health** (S, Bars).
    - Each account's coverage of the date range (a hatched track where there are no statements).
    - Warning showing the payments into cards that came from accounts Finora can't see.

## 6. Data rules (apply everywhere)

- **Card payments and transfers between the user's own accounts are never spending.** Exclude them from every total, and state the excluded amount where it matters.
- **Partial months.** Hatch them, label them "so far", and exclude them from averages and forecasts.
- **Earned stays "not confirmed"** until the user answers the deposit questions.
- **One-time flagged items** are excluded from forecasts and averages, and shown separately.
- **Forecasts always show a range and a confidence level.**
- **No invented numbers.** If a widget can't compute something, it shows its locked state.

## 7. Charts in Expo (important)

The mockups use CSS `conic-gradient` and gradient hatching. These do **not** exist in React Native.
- **Donuts and rings:** `react-native-svg` arcs (strokeDasharray on a circle, or path arcs), with a 0.6 to 1% gap between slices.
- **Hatching:** an SVG `<Pattern>` of 135° lines over the paper color.
- **Bars, waterfall and split bars:** Views with flex, or SVG. Use `victory-native` (Skia) only if it is already a dependency; don't add a heavy chart library for these simple shapes.
- **Every chart** gets `accessibilityRole="image"` and an `accessibilityLabel` that states the numbers (the mockup's `aria-label` text shows the pattern).
- **Animation** (optional): one short grow-in per chart on first load. Nothing that loops.

## 8. Accessibility and quality bar

- Contrast: 4.5:1 for text in both themes. The tokens already pass, so don't lighten captions.
- 44px minimum touch targets. Real buttons, links and switches with accessibility roles and labels.
- The theme follows the system setting, has a manual toggle in the top bar, and the choice persists.
- Web works from 360px to 1600px wide without horizontal scrolling.

## 9. Build order

1. `.gitignore` the reference folder (section 1), then write `docs/dashboard-audit.md` (section 0).
2. Theme tokens, fonts, logos, `<PoweredBy />`, light/dark switching.
3. App shell: top bar, sidebar, phone app bar and tab bar.
4. Widget registry, view presets, Supabase prefs table with RLS, the Customize drawer and sheet.
5. Data layer: one `useDashboardData(month)` hook backed by SQL views/RPCs. Write fictional seed data for local development.
6. All 22 widgets, each with its three readiness states, in the group order of section 5.
7. Tests for:
   - preset fallback, toggle persistence and reset;
   - readiness rules;
   - the exclusions in section 6;
   - forecast range output.

## 10. Definition of done

- All 22 widgets exist and render in light and dark, on phone and web, in every readiness state.
- Each of the 4 views opens with its preset. Toggles persist per user per view, and Reset restores the preset.
- No personal data in git (check: `git log -p | grep -i` for a few real merchant names returns nothing).
- The audit doc lists what existed before and what was added.

## 11. Open items for the user

- Supply the Sparktrum logo (an SVG or wide transparent PNG, ideally with the name, plus a white version for dark mode).
- Decide whether "New view" (custom views) is in the first release.
- The phone Customize bottom sheet isn't in the design yet. Build it from the drawer's content.
