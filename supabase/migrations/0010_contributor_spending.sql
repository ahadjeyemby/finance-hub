-- Audit: a Contributor adds to the admin's books and sees only spending. Run after 0008. Safe to run twice. Moves no data.
--
-- Until now a Contributor kept their own data and the admin read it (0006). From here on a Contributor adds receipts and credit card statements
-- to the ADMIN's books, and sees the admin's spending, refunds and fees, and nothing else: no deposits, salary, rewards or transfers, no balances,
-- no pay slips or income settings, no statements the admin uploaded. Nothing in what they receive says that any of it is recorded.
--
-- How it is kept honest:
--   * A Contributor gets no new access to the data tables. Everything they read or write goes through the functions below, which run as the
--     database owner and check every argument. Row level security cannot hide columns; these functions return only the columns they name.
--   * Which rows are spending is decided here, with the admin's own decisions (overlay patches and merchant rules) applied first, exactly as
--     applyOverlay in src/core/queries.ts does: a deposit the admin turned into a refund shows, a charge the admin marked as income does not.
--   * A Contributor never changes or deletes a row the admin holds. New statement rows are inserted with "on conflict do nothing". Their
--     changes to categories, tags and notes go to contributor_edits, their own rows, which the admin's app lays under the admin's own decisions.
--   * Pausing or ending the membership cuts every function off on the next call, as in 0006.

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Guard: the role changes meaning, so nobody who holds it today gains access without the admin knowing
-- ---------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare n integer;
begin
  if to_regclass('public.contributor_edits') is null then
    select count(*) into n from public.members where role = 'contributor';
    if n > 0 then
      raise exception 'Migration 0010 changes what a Contributor can see: they will see the admin''s spending. % membership(s) have the Contributor role today. Change them to Member on the People screen first, then run this again.', n;
    end if;
  end if;
end $$;

comment on column public.members.role is 'member: keeps their own books, which the admin can see. contributor: adds receipts and credit card statements to the admin''s books and sees only the admin''s spending (0009).';

-- who added a receipt or statement: lets a Contributor change the receipts they added, and only those
alter table public.receipts add column if not exists uploaded_by uuid default auth.uid() references auth.users on delete set null;
alter table public.statements add column if not exists uploaded_by uuid default auth.uid() references auth.users on delete set null;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- The admin whose books the caller contributes to, or null when the caller is not an active Contributor.
create or replace function public.contributor_owner()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.workspace_owner from public.members m where m.member = (select auth.uid()) and m.role = 'contributor' and m.active
$$;

-- The charge a tag edit belongs to: t:<txn id> for a charge, i:<txn id>:<cents>:<slug>:<nth> for one item on it (see src/core/tags.ts).
create or replace function public.tag_edit_txn_id(p_key text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p_key like 't:%' then substr(p_key, 3) else substring(p_key from '^i:(.*):-?[0-9]+:[^:]*:[0-9]+$') end
$$;

-- An owner's spending as a Contributor may see it: statement rows and cash entries, the owner's patches and merchant rules applied, only the
-- kinds spend, fee and refund, and only the columns listed. Internal: called by the functions below, never by the app.
create or replace function public.owner_spending(p_owner uuid)
returns table (
  id text, account_id text, date date, description text, merchant text, cents integer, kind text, category text, subcategory text,
  business boolean, one_off boolean, source text, ref text, note text, hints text[], manual boolean, receipt_id text, lines jsonb
)
language sql stable security definer set search_path = public, pg_temp as $$
  with ov as (
    select coalesce((select o.body from public.overlays o where o.user_id = p_owner), '{}'::jsonb) as body
  ),
  cash as (
    select m from ov, jsonb_array_elements(case when jsonb_typeof(ov.body -> 'manual') = 'array' then ov.body -> 'manual' else '[]'::jsonb end) m
     where jsonb_typeof(m) = 'object'
  ),
  base as (
    select t.id, t.account_id, t.date, t.description, t.merchant, t.cents, t.kind, t.category, t.subcategory, t.business, t.one_off, t.source,
           t.ref, t.note, t.hints, t.manual, t.receipt_id, t.lines
      from public.txns t
     where t.user_id = p_owner
    union all
    select m ->> 'id', coalesce(m ->> 'accountId', 'cash'),
           case when (m ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then (m ->> 'date')::date end,
           coalesce(m ->> 'description', ''), coalesce(m ->> 'merchant', ''),
           case when (m ->> 'cents') ~ '^-?\d+$' then (m ->> 'cents')::integer end,
           m ->> 'kind', m ->> 'category', m ->> 'subcategory',
           case when jsonb_typeof(m -> 'business') = 'boolean' then (m -> 'business')::text::boolean end,
           case when jsonb_typeof(m -> 'oneOff') = 'boolean' then (m -> 'oneOff')::text::boolean end,
           coalesce(m ->> 'source', ''), m ->> 'ref', m ->> 'note',
           array(select jsonb_array_elements_text(case when jsonb_typeof(m -> 'hints') = 'array' then m -> 'hints' else '[]'::jsonb end)),
           true, m ->> 'receiptId', m -> 'lines'
      from cash
  ),
  -- as applyOverlay: the merchant rule first (stored spend and refund only), then the patch; a key present with null sets null
  patched as (
    select b.id, b.account_id, b.date, b.description,
           case when x.p ? 'merchant' then x.p ->> 'merchant' else b.merchant end as merchant,
           b.cents,
           case when x.p ? 'kind' then x.p ->> 'kind' else b.kind end as kind,
           case when x.p ? 'category' then x.p ->> 'category'
                when b.kind in ('spend', 'refund') and x.r ? 'category' then x.r ->> 'category'
                else b.category end as category,
           b.subcategory,
           case when x.p ? 'business' then (case when jsonb_typeof(x.p -> 'business') = 'boolean' then (x.p -> 'business')::text::boolean end)
                when b.kind in ('spend', 'refund') and x.r ? 'business' then (case when jsonb_typeof(x.r -> 'business') = 'boolean' then (x.r -> 'business')::text::boolean end)
                else b.business end as business,
           case when x.p ? 'oneOff' then (case when jsonb_typeof(x.p -> 'oneOff') = 'boolean' then (x.p -> 'oneOff')::text::boolean end) else b.one_off end as one_off,
           b.source, b.ref,
           case when x.p ? 'note' then x.p ->> 'note' else b.note end as note,
           b.hints, b.manual,
           case when x.p ? 'receiptId' then x.p ->> 'receiptId' else b.receipt_id end as receipt_id,
           case when x.p ? 'lines' then x.p -> 'lines' else b.lines end as lines
      from base b
     cross join ov
     cross join lateral (
       select case when jsonb_typeof(ov.body -> 'patches' -> b.id) = 'object' then ov.body -> 'patches' -> b.id else '{}'::jsonb end as p,
              case when jsonb_typeof(ov.body -> 'merchantRules' -> b.merchant) = 'object' then ov.body -> 'merchantRules' -> b.merchant else '{}'::jsonb end as r
     ) x
  )
  select p.id, p.account_id, p.date, p.description, p.merchant, p.cents, p.kind, p.category, p.subcategory, p.business, p.one_off, p.source,
         p.ref, p.note,
         -- only the hints that are about spending: confirm_income and confirm_transfer_account never leave
         array(select h from unnest(p.hints) h where h in ('needs_items', 'unknown_merchant', 'person_payment', 'business_or_personal', 'large_one_off')),
         p.manual, p.receipt_id, p.lines
    from patched p
   where p.kind in ('spend', 'fee', 'refund') and p.id is not null and p.date is not null and p.cents is not null
$$;

-- May a Contributor of p_owner touch this charge or receipt? A receipt counts when it is not linked to anything, or linked to spending.
create or replace function public.contributor_sees(p_owner uuid, p_kind text, p_ref text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case p_kind
    when 'txn' then exists (select 1 from public.owner_spending(p_owner) s where s.id = p_ref)
    when 'receipt' then exists (
      select 1 from public.receipts r
       where r.user_id = p_owner and r.id::text = p_ref and r.kind in ('store_receipt', 'order_confirmation', 'order_history')
         and (not exists (select 1 from public.receipt_links l where l.user_id = p_owner and l.receipt_id = r.id)
              or exists (select 1 from public.receipt_links l join public.owner_spending(p_owner) s on s.id = l.txn_id where l.user_id = p_owner and l.receipt_id = r.id)))
    else false end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Reading: everything a Contributor's app shows, in one call
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- txns and accounts come in the row shapes of src/core/sync.ts, so the app maps them as it maps its own rows. The owner's patches and merchant
-- rules are already applied: none are sent.
create or replace function public.contributor_spending()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o uuid := public.contributor_owner();
  ov jsonb;
  result jsonb;
begin
  if o is null then raise exception 'Only a contributor can read this'; end if;
  ov := coalesce((select body from public.overlays where user_id = o), '{}'::jsonb);
  with s as (select * from public.owner_spending(o)),
  acc as (
    select a.* from public.accounts a
     where a.user_id = o and a.merged_into is null and (a.type = 'credit' or a.id in (select s.account_id from s))
  ),
  rc as (
    select r.* from public.receipts r
     where r.user_id = o and r.kind in ('store_receipt', 'order_confirmation', 'order_history')
       and (not exists (select 1 from public.receipt_links l where l.user_id = o and l.receipt_id = r.id)
            or exists (select 1 from public.receipt_links l where l.user_id = o and l.receipt_id = r.id and l.txn_id in (select s.id from s)))
  )
  select jsonb_build_object(
    'owner', o,
    -- a credit card's other numbers are kept so a reissued card is recognised on import; no income_complete, no checking account numbers
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'institution', a.institution, 'type', a.type, 'last4', a.last4,
        'coverage_from', a.coverage_from, 'coverage_to', a.coverage_to, 'extra_numbers', case when a.type = 'credit' then a.extra_numbers else '[]'::jsonb end) order by a.id) from acc a), '[]'::jsonb),
    'txns', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('subtype', null, 'pair_id', null) order by s.date, s.id) from s), '[]'::jsonb),
    -- which periods of each card are already in, for the import's coverage check: no balances, totals or terms
    'statements', coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'account_id', st.account_id, 'period_from', st.period_from, 'period_to', st.period_to) order by st.period_from, st.id)
        from public.statements st where st.user_id = o and st.account_id in (select a.id from acc a where a.type = 'credit')), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' - 'txn_id' - 'uploaded_by' order by r.created_at, r.id) from rc r), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(l) - 'user_id' order by l.created_at, l.id) from public.receipt_links l
        where l.user_id = o and l.txn_id in (select s.id from s) and l.receipt_id in (select r.id from rc r)), '[]'::jsonb),
    'flags', coalesce((select jsonb_agg(to_jsonb(f) - 'user_id' order by f.kind, f.ref_id) from public.link_flags f
        where f.user_id = o and ((f.kind = 'txn' and f.ref_id in (select s.id from s)) or (f.kind = 'receipt' and f.ref_id in (select r.id::text from rc r)))), '[]'::jsonb),
    'categories', case when jsonb_typeof(ov -> 'categories') = 'object' then ov -> 'categories' else null end,
    'tags', jsonb_build_object(
      'defs', case when jsonb_typeof(ov -> 'tags' -> 'defs') = 'array' then ov -> 'tags' -> 'defs' else '[]'::jsonb end,
      'edits', coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(case when jsonb_typeof(ov -> 'tags' -> 'edits') = 'object' then ov -> 'tags' -> 'edits' else '{}'::jsonb end) e
        where public.tag_edit_txn_id(e.key) in (select s.id from s)), '{}'::jsonb))
  ) into result;
  return result;
end $$;

-- Is this file already in the owner's books? Only yes or no: the import's repeat check.
create or replace function public.contributor_file_seen(p_kind text, p_sha256 text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o uuid := public.contributor_owner();
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  if p_kind = 'receipt' then return exists (select 1 from public.receipts where user_id = o and sha256 = p_sha256); end if;
  if p_kind = 'statement' then return exists (select 1 from public.statements where user_id = o and sha256 = p_sha256); end if;
  raise exception 'Unknown kind of file';
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- A Contributor's changes: their own rows, laid under the owner's decisions by the owner's app
-- ---------------------------------------------------------------------------------------------------------------------------------------------
--   t:<txn id>        a change to one charge: category, subcategory, business, oneOff, note, lines, receiptId
--   m:<merchant>      a rule for every charge from a merchant: category, business
--   g:<tag edit key>  a tag change, keyed as in src/core/tags.ts: add, remove, category
create table if not exists public.contributor_edits (
  owner uuid not null references auth.users on delete cascade,
  contributor uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  patch jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, contributor, key)        -- two contributors never write the same row
);
alter table public.contributor_edits enable row level security;

create or replace function public.contributor_edits_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  allowed text[];
  target text;
begin
  -- checked here as well as by the policies, so the checks below never answer questions about someone else's books
  if new.contributor is distinct from (select auth.uid()) or new.owner is distinct from public.contributor_owner() then
    raise exception 'Only a contributor can change this, in their own workspace';
  end if;
  if jsonb_typeof(new.patch) is distinct from 'object' then raise exception 'An edit must be a set of fields'; end if;
  if new.key like 't:%' then allowed := array['category', 'subcategory', 'business', 'oneOff', 'note', 'lines', 'receiptId']; target := substr(new.key, 3);
  elsif new.key like 'm:%' then allowed := array['category', 'business'];
  elsif new.key like 'g:%' then allowed := array['add', 'remove', 'category']; target := public.tag_edit_txn_id(substr(new.key, 3));
  else raise exception 'Unknown kind of edit';
  end if;
  if exists (select 1 from jsonb_object_keys(new.patch) k where k <> all (allowed)) then raise exception 'A contributor cannot change that'; end if;
  if new.key like 'm:%' then
    if not exists (select 1 from public.owner_spending(new.owner) s where s.merchant = substr(new.key, 3)) then raise exception 'There is nothing to change'; end if;
  elsif target is null or not exists (select 1 from public.owner_spending(new.owner) s where s.id = target) then
    raise exception 'There is nothing to change';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists contributor_edits_check on public.contributor_edits;
create trigger contributor_edits_check before insert or update on public.contributor_edits for each row execute function public.contributor_edits_check();

drop policy if exists contributor_edits_own on public.contributor_edits;
create policy contributor_edits_own on public.contributor_edits for all to authenticated
  using (contributor = (select auth.uid()) and owner = public.contributor_owner())
  with check (contributor = (select auth.uid()) and owner = public.contributor_owner());
-- the owner reads them (to lay them under their own decisions) and may remove one; never writes them
drop policy if exists contributor_edits_owner_read on public.contributor_edits;
create policy contributor_edits_owner_read on public.contributor_edits for select to authenticated using (owner = (select auth.uid()));
drop policy if exists contributor_edits_owner_delete on public.contributor_edits;
create policy contributor_edits_owner_delete on public.contributor_edits for delete to authenticated using (owner = (select auth.uid()));
create index if not exists contributor_edits_owner on public.contributor_edits (owner);

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Receipts, links and "no link expected"
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- p_row is the shape receiptToRow (src/core/evidence.ts) makes. A file already stored (same fingerprint) is not added again: its id comes back.
create or replace function public.contributor_save_receipt(p_row jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o uuid := public.contributor_owner();
  r public.receipts;
  rid uuid;
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  r := jsonb_populate_record(null::public.receipts, p_row);
  if r.storage_path is not null and r.storage_path not like o::text || '/%' then raise exception 'The file must be stored in the workspace folder'; end if;
  if coalesce(r.kind, 'store_receipt') not in ('store_receipt', 'order_confirmation', 'order_history') then raise exception 'Unknown kind of receipt'; end if;
  if r.sha256 is not null then
    select id into rid from public.receipts where user_id = o and sha256 = r.sha256;
    if rid is not null then return rid; end if;
  end if;
  insert into public.receipts (user_id, txn_id, storage_path, merchant, date, total_cents, lines, kind, "time", subtotal_cents, tax_cents, tip_cents, discount_cents,
                               currency, payment_method, card_last4, store_address, store_ref, order_ref, source_file, sha256, origin, captured_at, raw, uploaded_by)
  values (o, null, r.storage_path, r.merchant, r.date, r.total_cents, coalesce(r.lines, '[]'::jsonb), coalesce(r.kind, 'store_receipt'), r."time", r.subtotal_cents,
          r.tax_cents, r.tip_cents, r.discount_cents, coalesce(r.currency, 'USD'), r.payment_method, r.card_last4, r.store_address, r.store_ref, r.order_ref,
          r.source_file, r.sha256, coalesce(r.origin, 'app_upload'), r.captured_at, coalesce(r.raw, '{}'::jsonb), (select auth.uid()))
  returning id into rid;
  return rid;
end $$;

-- A correction to a receipt the Contributor added themselves; p_row is the shape receiptUpdate makes. The file and fingerprint never change.
create or replace function public.contributor_update_receipt(p_id uuid, p_row jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o uuid := public.contributor_owner();
  r public.receipts;
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  r := jsonb_populate_record(null::public.receipts, p_row);
  if coalesce(r.kind, 'store_receipt') not in ('store_receipt', 'order_confirmation', 'order_history') then raise exception 'Unknown kind of receipt'; end if;
  update public.receipts
     set kind = coalesce(r.kind, kind), merchant = r.merchant, date = r.date, "time" = r."time", total_cents = r.total_cents, subtotal_cents = r.subtotal_cents,
         tax_cents = r.tax_cents, tip_cents = r.tip_cents, discount_cents = r.discount_cents, currency = coalesce(r.currency, currency),
         payment_method = r.payment_method, card_last4 = r.card_last4, store_address = r.store_address, store_ref = r.store_ref, order_ref = r.order_ref,
         lines = coalesce(r.lines, lines), raw = coalesce(r.raw, raw)
   where id = p_id and user_id = o and uploaded_by = (select auth.uid());
  if not found then raise exception 'You can change only the receipts you added'; end if;
end $$;

-- p_links: [{receipt_id, txn_id, amount_cents, role, method, reason, confirmed}], as linkToRow (src/data/links.ts) makes them.
create or replace function public.contributor_save_links(p_links jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o uuid := public.contributor_owner();
  n integer;
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  if jsonb_typeof(p_links) is distinct from 'array' then raise exception 'bad request'; end if;
  if exists (select 1 from jsonb_to_recordset(p_links) x(receipt_id uuid, txn_id text)
              where x.receipt_id is null or x.txn_id is null
                 or not public.contributor_sees(o, 'txn', x.txn_id)
                 or not exists (select 1 from public.receipts r where r.user_id = o and r.id = x.receipt_id)) then
    raise exception 'A receipt can be linked only to spending';
  end if;
  insert into public.receipt_links (user_id, receipt_id, txn_id, amount_cents, role, method, reason, confirmed)
  select o, x.receipt_id, x.txn_id, x.amount_cents, coalesce(x.role, 'primary'), x.method, x.reason, coalesce(x.confirmed, false)
    from jsonb_to_recordset(p_links) x(receipt_id uuid, txn_id text, amount_cents integer, role text, method text, reason text, confirmed boolean)
  on conflict (receipt_id, txn_id) do update
    set amount_cents = excluded.amount_cents, role = excluded.role, method = excluded.method, reason = excluded.reason, confirmed = excluded.confirmed;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.contributor_delete_link(p_receipt uuid, p_txn text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o uuid := public.contributor_owner();
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  if not public.contributor_sees(o, 'txn', p_txn) then raise exception 'There is nothing to change'; end if;
  delete from public.receipt_links where user_id = o and receipt_id = p_receipt and txn_id = p_txn;
end $$;

create or replace function public.contributor_set_flag(p_kind text, p_ref text, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o uuid := public.contributor_owner();
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  if not public.contributor_sees(o, p_kind, p_ref) then raise exception 'There is nothing to change'; end if;
  insert into public.link_flags (user_id, kind, ref_id, reason, note) values (o, p_kind, p_ref, p_reason, p_note)
  on conflict (user_id, kind, ref_id) do update set reason = excluded.reason, note = excluded.note;
end $$;

create or replace function public.contributor_clear_flag(p_kind text, p_ref text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o uuid := public.contributor_owner();
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  if not public.contributor_sees(o, p_kind, p_ref) then raise exception 'There is nothing to change'; end if;
  delete from public.link_flags where user_id = o and kind = p_kind and ref_id = p_ref;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Credit card statements
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- The arguments are the row shapes the app already uploads (accountToRow, statementToRow, txnToRow, rawToRow). Only a credit card: checking
-- statements carry pay and are added by the owner. Rows the owner already holds stay exactly as they are, and a new card payment is left
-- unpaired: its other half is on a checking account the Contributor cannot see, so the owner's app pairs it. The answer counts spending only.
create or replace function public.contributor_save_statement(p_account jsonb, p_statement jsonb, p_txns jsonb, p_raw jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o uuid := public.contributor_owner();
  acc_id text := p_account ->> 'id';
  st_id text := p_statement ->> 'id';
  path text := p_statement ->> 'storage_path';
  cur public.accounts;
  st_added integer;
  spend_new integer;
  spend_all integer;
  card_only constant text := 'Only credit card statements can be added here. Checking statements are added by the person who runs this workspace.';
begin
  if o is null then raise exception 'Only a contributor can do this'; end if;
  if coalesce(p_account ->> 'type', '') <> 'credit' then raise exception '%', card_only; end if;
  if coalesce(acc_id, '') = '' or coalesce(st_id, '') = '' then raise exception 'The statement is missing its card or its name'; end if;
  if jsonb_typeof(p_txns) is distinct from 'array' or jsonb_typeof(coalesce(p_raw, '[]'::jsonb)) is distinct from 'array' then raise exception 'bad request'; end if;
  if path is not null and path not like o::text || '/%' then raise exception 'The file must be stored in the workspace folder'; end if;
  if exists (select 1 from jsonb_array_elements(p_txns) t where coalesce(t ->> 'id', '') = '') then raise exception 'A row is missing its id'; end if;
  if exists (select 1 from jsonb_array_elements(p_txns) t where t ->> 'account_id' is distinct from acc_id) then raise exception 'Every row must belong to the statement''s card'; end if;
  if exists (select 1 from jsonb_array_elements(p_txns) t where coalesce(t ->> 'kind', '') not in ('spend', 'fee', 'refund', 'rewards', 'transfer')) then
    raise exception 'A credit card statement can hold only charges, refunds, fees, rewards and payments';
  end if;

  select * into cur from public.accounts where user_id = o and id = acc_id;
  if found then
    if cur.type <> 'credit' then raise exception '%', card_only; end if;
    if cur.merged_into is not null then raise exception 'That card was merged into another account. Ask the person who runs this workspace.'; end if;
    update public.accounts
       set coverage_from = least(coverage_from, (p_account ->> 'coverage_from')::date), coverage_to = greatest(coverage_to, (p_account ->> 'coverage_to')::date)
     where user_id = o and id = acc_id;
  else
    insert into public.accounts (id, user_id, name, institution, type, last4, coverage_from, coverage_to, extra_numbers)
    values (acc_id, o, coalesce(nullif(p_account ->> 'name', ''), 'Credit card'), coalesce(p_account ->> 'institution', ''), 'credit', coalesce(p_account ->> 'last4', ''),
            (p_account ->> 'coverage_from')::date, (p_account ->> 'coverage_to')::date,
            case when jsonb_typeof(p_account -> 'extra_numbers') = 'array' then p_account -> 'extra_numbers' else '[]'::jsonb end);
  end if;

  insert into public.statements (id, user_id, account_id, institution, last4, product, label, period_from, period_to, issued_on, due_on, opening_balance_cents,
                                 closing_balance_cents, totals, terms, reconciled, reconciliation, source_file, sha256, storage_path, pages, raw, uploaded_by)
  select st_id, o, acc_id, s.institution, s.last4, s.product, s.label, s.period_from, s.period_to, s.issued_on, s.due_on, s.opening_balance_cents,
         s.closing_balance_cents, coalesce(s.totals, '{}'::jsonb), coalesce(s.terms, '{}'::jsonb), s.reconciled, s.reconciliation, s.source_file, s.sha256, path,
         s.pages, coalesce(s.raw, '{}'::jsonb), (select auth.uid())
    from jsonb_populate_record(null::public.statements, p_statement) s
  on conflict (user_id, id) do nothing;
  get diagnostics st_added = row_count;

  with x as (
    select * from jsonb_to_recordset(p_txns) as x(id text, date date, description text, merchant text, cents integer, kind text, subtype text, category text,
                                                  subcategory text, business boolean, one_off boolean, source text, ref text, note text, hints jsonb, lines jsonb)
  ),
  ins as (
    insert into public.txns (id, user_id, account_id, date, description, merchant, cents, kind, subtype, category, subcategory, business, one_off, source, ref, note, hints, lines)
    select x.id, o, acc_id, x.date, coalesce(x.description, ''), x.merchant, x.cents, x.kind, case when x.kind in ('transfer', 'rewards') then x.subtype end,
           x.category, x.subcategory, x.business, x.one_off, coalesce(x.source, ''), x.ref, x.note,
           array(select jsonb_array_elements_text(case when jsonb_typeof(x.hints) = 'array' then x.hints else '[]'::jsonb end)), x.lines
      from x
    on conflict (user_id, id) do nothing
    returning kind
  )
  select count(*) filter (where ins.kind in ('spend', 'fee', 'refund')) into spend_new from ins;
  select count(*) into spend_all from jsonb_array_elements(p_txns) t where t ->> 'kind' in ('spend', 'fee', 'refund');

  insert into public.txn_raw (user_id, txn_id, statement_id, line_no, posted_date, source_file, "row")
  select o, r.txn_id, st_id, r.line_no, r.posted_date, r.source_file, coalesce(r."row", '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_raw, '[]'::jsonb)) as r(txn_id text, line_no integer, posted_date date, source_file text, "row" jsonb)
   where r.txn_id in (select t ->> 'id' from jsonb_array_elements(p_txns) t)
  on conflict (user_id, txn_id) do nothing;

  return jsonb_build_object('statement', case when st_added > 0 then 'added' else 'already stored' end,
                            'spending_added', spend_new, 'spending_already_stored', spend_all - spend_new);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Files: receipt photos in the owner's folder can be added and opened; a statement file can only be added, never opened again
-- ---------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists receipts_contributor_read on storage.objects;
create policy receipts_contributor_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.contributor_owner()::text);
drop policy if exists receipts_contributor_add on storage.objects;
create policy receipts_contributor_add on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.contributor_owner()::text);
drop policy if exists receipts_contributor_replace on storage.objects;
create policy receipts_contributor_replace on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.contributor_owner()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.contributor_owner()::text);
drop policy if exists statements_contributor_add on storage.objects;
create policy statements_contributor_add on storage.objects for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = public.contributor_owner()::text);

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.owner_spending(uuid), public.contributor_sees(uuid, text, text) from public, anon, authenticated;
revoke all on function public.contributor_owner(), public.tag_edit_txn_id(text), public.contributor_spending(), public.contributor_file_seen(text, text),
  public.contributor_save_receipt(jsonb), public.contributor_update_receipt(uuid, jsonb), public.contributor_save_links(jsonb), public.contributor_delete_link(uuid, text),
  public.contributor_set_flag(text, text, text, text), public.contributor_clear_flag(text, text), public.contributor_save_statement(jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.contributor_owner(), public.tag_edit_txn_id(text), public.contributor_spending(), public.contributor_file_seen(text, text),
  public.contributor_save_receipt(jsonb), public.contributor_update_receipt(uuid, jsonb), public.contributor_save_links(jsonb), public.contributor_delete_link(uuid, text),
  public.contributor_set_flag(text, text, text, text), public.contributor_clear_flag(text, text), public.contributor_save_statement(jsonb, jsonb, jsonb, jsonb)
  to authenticated;
revoke all on function public.contributor_edits_check() from public, anon, authenticated;
