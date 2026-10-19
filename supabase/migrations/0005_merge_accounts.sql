-- Audit: merge two accounts that are really one (a statement with a changed number created a second account).
-- Nothing is deleted. The transactions and statements of the merged-away account move to the one you keep; the merged-away account stays as a row
-- marked merged_into, hidden from the app, so a merge can be undone. Both run as ONE transaction: all of it happens or none of it.
-- Row level security applies (the functions run as the signed-in person). Run after 0004. Safe to run twice. Moves no data by itself.

alter table public.accounts add column if not exists merged_into text;     -- set on the account that was merged away: the id it was merged into
alter table public.txns add column if not exists merged_from text;         -- set on a transaction that was moved: the account it came from
alter table public.statements add column if not exists merged_from text;   -- same, for statements

-- p_numbers: the kept account's complete list of extra numbers after the merge, worked out by the app (the merged-away account's own numbers are added to it).
create or replace function public.merge_accounts(p_source text, p_target text, p_numbers jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s public.accounts;
  t public.accounts;
  moved_txns integer;
  moved_statements integer;
begin
  select * into s from public.accounts where id = p_source and user_id = auth.uid();
  select * into t from public.accounts where id = p_target and user_id = auth.uid();
  if s.id is null or t.id is null then raise exception 'Account not found'; end if;
  if s.id = t.id then raise exception 'Choose two different accounts'; end if;
  if s.type = 'cash' or t.type = 'cash' then raise exception 'The cash account cannot be merged'; end if;
  if s.type <> t.type then raise exception 'Only accounts of the same type can be merged'; end if;
  if s.merged_into is not null or t.merged_into is not null then raise exception 'One of these accounts is already merged'; end if;

  update public.txns set merged_from = p_source, account_id = p_target where user_id = auth.uid() and account_id = p_source;
  get diagnostics moved_txns = row_count;
  update public.statements set merged_from = p_source, account_id = p_target where user_id = auth.uid() and account_id = p_source;
  get diagnostics moved_statements = row_count;

  update public.accounts
     set extra_numbers = coalesce(p_numbers, extra_numbers),
         coverage_from = least(coverage_from, s.coverage_from),
         coverage_to = greatest(coverage_to, s.coverage_to)
   where id = p_target and user_id = auth.uid();
  update public.accounts set merged_into = p_target where id = p_source and user_id = auth.uid();

  return jsonb_build_object('transactions', moved_txns, 'statements', moved_statements);
end;
$$;

-- Undo: everything that was moved goes back to the account it came from, which is shown again. p_numbers is the kept account's extra numbers without the ones the merge added.
create or replace function public.unmerge_accounts(p_source text, p_numbers jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s public.accounts;
  moved_txns integer;
  moved_statements integer;
  first_day date;
  last_day date;
begin
  select * into s from public.accounts where id = p_source and user_id = auth.uid();
  if s.id is null or s.merged_into is null then raise exception 'This account is not merged'; end if;

  update public.txns set account_id = p_source, merged_from = null where user_id = auth.uid() and merged_from = p_source;
  get diagnostics moved_txns = row_count;
  update public.statements set account_id = p_source, merged_from = null where user_id = auth.uid() and merged_from = p_source;
  get diagnostics moved_statements = row_count;

  -- the kept account covers only what its own statements cover again
  select min(period_from), max(period_to) into first_day, last_day from public.statements where user_id = auth.uid() and account_id = s.merged_into;
  update public.accounts
     set extra_numbers = coalesce(p_numbers, extra_numbers),
         coverage_from = coalesce(first_day, coverage_from),
         coverage_to = coalesce(last_day, coverage_to)
   where id = s.merged_into and user_id = auth.uid();
  update public.accounts set merged_into = null where id = p_source and user_id = auth.uid();

  return jsonb_build_object('transactions', moved_txns, 'statements', moved_statements);
end;
$$;
