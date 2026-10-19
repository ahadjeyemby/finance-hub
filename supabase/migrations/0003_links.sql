-- Audit: links between receipts and statement charges, as a real relationship.
-- Replaces three half-owners of the same fact (receipts.txn_id, the overlay's receiptId patch, txns.receipt_id): after this migration the
-- links live here and nothing else is written. The old columns stay so nothing breaks, but the app no longer reads or writes them.
-- Run after 0002. Safe to run twice. Moves no data.

-- A receipt can explain many charges (paid half by points, half by card) and a charge can be explained by many receipts
-- (order confirmation and store receipt, or one Amazon charge for several receipts).
create table if not exists public.receipt_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  txn_id text not null,                    -- no foreign key: a hand-entered cash purchase lives in the overlay, not in txns. The app ignores a link whose charge is gone and offers to remove it.
  amount_cents integer,                    -- how much of the charge this receipt accounts for; null = the whole charge
  role text not null default 'primary' check (role in ('primary', 'extra', 'refund', 'split')),
  method text not null check (method in ('order_number', 'card', 'store', 'confirmed', 'manual')),
  reason text,                             -- the evidence, in words: "same amount, 2 days apart, paid with your card ending 9780"
  confirmed boolean not null default false,-- true once the person approved it (or chose it themselves)
  created_at timestamptz not null default now(),
  unique (receipt_id, txn_id)
);
create index if not exists receipt_links_txn on public.receipt_links (user_id, txn_id);
create index if not exists receipt_links_receipt on public.receipt_links (user_id, receipt_id);

-- "No link expected": a receipt paid in cash, from another account or with a gift card; a charge that never has a receipt (rent, a transfer).
-- ref_id is the receipts.id (as text) or the txns.id. Without a row here, a receipt or charge with no link is shown as not linked.
create table if not exists public.link_flags (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('receipt', 'txn')),
  ref_id text not null,
  reason text not null check (reason in ('cash', 'other_account', 'gift_card', 'no_receipt', 'other')),
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

alter table public.receipt_links enable row level security;
alter table public.link_flags enable row level security;
do $$
declare t text;
begin
  foreach t in array array['receipt_links', 'link_flags'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_owner', t);
  end loop;
end $$;
