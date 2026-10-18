-- Audit: per-user storage. Every table is owner-only through row level security.
-- The app is local-first today; this schema is the sync target when you sign in.

create table if not exists public.accounts (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  institution text not null default '',
  type text not null check (type in ('checking', 'credit', 'cash')),
  last4 text not null default '',
  coverage_from date not null,
  coverage_to date not null,
  income_complete boolean,
  primary key (user_id, id)
);

create table if not exists public.txns (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id text not null,
  date date not null,
  description text not null default '',
  merchant text not null,
  cents integer not null,
  kind text not null check (kind in ('spend', 'fee', 'refund', 'income', 'rewards', 'transfer')),
  subtype text,
  category text,
  subcategory text,
  business boolean,
  one_off boolean,
  pair_id text,
  source text not null default '',
  ref text,
  note text,
  hints text[] not null default '{}',
  manual boolean not null default false,
  receipt_id text,
  lines jsonb,
  primary key (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id)
);
create index if not exists txns_user_date on public.txns (user_id, date);
create index if not exists txns_user_merchant on public.txns (user_id, merchant);

-- Everything the person decided: answers, per-transaction patches, merchant rules, saved reports.
create table if not exists public.overlays (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  body jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  txn_id text,
  storage_path text,
  merchant text,
  date date,
  total_cents integer,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.txns enable row level security;
alter table public.overlays enable row level security;
alter table public.receipts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts', 'txns', 'overlays', 'receipts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_owner', t);
  end loop;
end $$;

-- Private bucket for receipt photos, one folder per user.
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
drop policy if exists receipts_owner_files on storage.objects;
create policy receipts_owner_files on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
