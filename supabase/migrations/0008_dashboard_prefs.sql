-- Which dashboard widgets each person shows in each view, and in what order. A view with no rows shows its preset (defined in the app,
-- src/dashboard/presets.ts). The app saves a view as a whole: one row per widget, switched off ones included, so a view with everything
-- switched off stays that way instead of falling back to the preset. "Reset to default" deletes the person's rows for that view.
--
-- Preferences belong to the person signed in. Unlike the ledger tables, a workspace admin cannot read or change a member's choices.

create table if not exists public.dashboard_widget_prefs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  view text not null check (view in ('overview', 'household', 'business', 'plan')),
  widget_id text not null check (widget_id in (
    'kpis', 'cashflow', 'donut', 'trend', 'oneTime',
    'cutIdeas', 'fixedFlex', 'subscriptions', 'grocery', 'bigbox', 'fuel',
    'forecast', 'forecastBuild', 'pace', 'billsOnce',
    'bizSummary', 'bizPending', 'bizDonut', 'bizTools', 'bizPL',
    'attention', 'dataHealth'
  )),
  enabled boolean not null,
  position integer not null check (position >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, view, widget_id)
);

alter table public.dashboard_widget_prefs enable row level security;

drop policy if exists dashboard_widget_prefs_owner on public.dashboard_widget_prefs;
create policy dashboard_widget_prefs_owner on public.dashboard_widget_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
