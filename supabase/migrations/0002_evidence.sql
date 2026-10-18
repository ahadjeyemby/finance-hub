-- Audit: keep everything the source documents say, not only what the app uses today.
-- Adds statements, the untouched source line behind each transaction, richer receipts and a bucket for original files.
-- Run after 0001. Safe to run twice.

-- One row per statement document (a month of a bank account or card).
create table if not exists public.statements (
  id text not null,                       -- stable name, e.g. eStmt_2026-09-10
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id text,                        -- null for an account the ledger does not track (a statement kept as evidence only)
  institution text,
  last4 text,
  product text,
  label text,
  period_from date,
  period_to date,
  issued_on date,
  due_on date,
  opening_balance_cents integer,
  closing_balance_cents integer,
  totals jsonb not null default '{}'::jsonb,       -- every total printed on the statement, in cents, under the statement's own names
  terms jsonb not null default '{}'::jsonb,        -- APR, credit limit, minimum payment, rewards summary, anything else printed
  reconciled boolean,                              -- did the extracted rows add up to the printed totals
  reconciliation jsonb,
  source_file text,                                -- file name as received
  sha256 text,                                     -- fingerprint of the original file
  storage_path text,                               -- original file in the private 'statements' bucket
  pages integer,
  raw jsonb not null default '{}'::jsonb,          -- extraction output that has no column yet
  extracted_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id)
);

-- The statement line exactly as extracted, one row per transaction. Kept out of txns so the app's sync stays small.
create table if not exists public.txn_raw (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  txn_id text not null,
  statement_id text,
  line_no integer,
  posted_date date,
  source_file text,
  row jsonb not null,
  primary key (user_id, txn_id),
  foreign key (user_id, txn_id) references public.txns (user_id, id) on delete cascade
);
create index if not exists txn_raw_statement on public.txn_raw (user_id, statement_id);

-- Receipts: add the fields a receipt actually carries. created_at (already there) is when it was uploaded.
alter table public.receipts add column if not exists kind text not null default 'store_receipt';  -- store_receipt | order_confirmation | order_history
alter table public.receipts add column if not exists time text;
alter table public.receipts add column if not exists subtotal_cents integer;
alter table public.receipts add column if not exists tax_cents integer;
alter table public.receipts add column if not exists tip_cents integer;
alter table public.receipts add column if not exists discount_cents integer;
alter table public.receipts add column if not exists currency text not null default 'USD';
alter table public.receipts add column if not exists payment_method text;
alter table public.receipts add column if not exists card_last4 text;
alter table public.receipts add column if not exists store_address text;
alter table public.receipts add column if not exists store_ref text;       -- store or terminal number printed on the receipt
alter table public.receipts add column if not exists order_ref text;       -- order number, matches txns.ref when there is one
alter table public.receipts add column if not exists source_file text;
alter table public.receipts add column if not exists sha256 text;
alter table public.receipts add column if not exists origin text not null default 'app_upload';  -- app_upload | offline_extract | typed
alter table public.receipts add column if not exists captured_at timestamptz;                    -- when the photo was taken, if known
alter table public.receipts add column if not exists raw jsonb not null default '{}'::jsonb;     -- everything read from the document
create index if not exists receipts_user_txn on public.receipts (user_id, txn_id);
create unique index if not exists receipts_user_sha on public.receipts (user_id, sha256);  -- nulls stay distinct, so typed receipts are unaffected

alter table public.statements enable row level security;
alter table public.txn_raw enable row level security;

do $$
declare t text;
begin
  foreach t in array array['statements', 'txn_raw'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_owner', t);
  end loop;
end $$;

-- Original statement files, one folder per user, same rule as the receipts bucket.
insert into storage.buckets (id, name, public) values ('statements', 'statements', false) on conflict (id) do nothing;
drop policy if exists statements_owner_files on storage.objects;
create policy statements_owner_files on storage.objects for all to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);
