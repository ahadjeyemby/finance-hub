-- Audit: workspaces. One person (the admin) can invite others (members). Everyone writes their own data and sees only their own; the admin can also
-- see and change everything their members hold. Nothing about who sees what is decided by the app: it is all enforced here, by row level security.
-- Run after 0005. Safe to run twice. Moves no data: every existing user stays a person with no members, who sees exactly what they saw before.
--
-- How it works
--   * Every data row already carries user_id: whose data it is. That does not change, and a row keeps belonging to its person.
--   * public.members says who belongs to whose workspace. A person is the admin of the workspace in which they are workspace_owner.
--   * A row is visible and writable to its own person, and to the admin of that person's workspace while the membership is active.
--   * Overlays (a person's own decisions, categories, tags) can be read by the admin but only written by their person: the admin's own changes to
--     someone else's charges (a category, a tag) are kept in the admin's own overlay, so two people never write the same row.
--   * Membership can only be created by accepting an invite sent to the member's own email address, so an admin can never claim someone else's data.
--   * A member can leave, and the admin can pause or end a membership. Either takes effect on the next query, not at the end of a session.

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Who belongs to whose workspace
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.members (
  workspace_owner uuid not null references auth.users on delete cascade,
  member uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('member', 'contributor')),   -- contributor: adds entries and sees only their own; the same data boundary, a narrower app
  can_read_ai boolean not null default false,                                      -- may use the paid readers (statements, receipts, pay slips) on the admin's credit
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (workspace_owner, member),
  unique (member),                                                                  -- one workspace per person
  check (workspace_owner <> member)
);
create index if not exists members_owner on public.members (workspace_owner) where active;

-- an admin cannot also be a member somewhere else, and a member cannot also run a workspace
create or replace function public.members_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.members where member = new.workspace_owner) then raise exception 'A member cannot also manage a workspace'; end if;
  if exists (select 1 from public.members where workspace_owner = new.member) then raise exception 'Someone who manages a workspace cannot join another'; end if;
  return new;
end $$;
drop trigger if exists members_guard on public.members;
create trigger members_guard before insert on public.members for each row execute function public.members_guard();

alter table public.members enable row level security;
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (workspace_owner = (select auth.uid()) or member = (select auth.uid()));
drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members for update to authenticated using (workspace_owner = (select auth.uid())) with check (workspace_owner = (select auth.uid()));
drop policy if exists members_end on public.members;
create policy members_end on public.members for delete to authenticated using (workspace_owner = (select auth.uid()) or member = (select auth.uid()));
-- nobody inserts a membership directly (accept_invite does), and the admin may change only the terms, never whose membership it is
revoke all on public.members from authenticated, anon;
grant select on public.members to authenticated;
grant update (role, can_read_ai, active) on public.members to authenticated;
grant delete on public.members to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Invites: the only way a membership comes about
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_owner uuid not null default auth.uid() references auth.users on delete cascade,
  email text not null,                                   -- lower case; only the person who signs in with this address can accept
  role text not null default 'member' check (role in ('member', 'contributor')),
  can_read_ai boolean not null default false,
  token_hash text not null,                              -- the token itself is shown once and never stored
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invites_owner on public.invites (workspace_owner);

alter table public.invites enable row level security;
drop policy if exists invites_owner_read on public.invites;
create policy invites_owner_read on public.invites for select to authenticated using (workspace_owner = (select auth.uid()));
drop policy if exists invites_owner_delete on public.invites;
create policy invites_owner_delete on public.invites for delete to authenticated using (workspace_owner = (select auth.uid()));
revoke all on public.invites from authenticated, anon;
grant select (id, workspace_owner, email, role, can_read_ai, expires_at, accepted_at, created_at) on public.invites to authenticated;   -- not token_hash
grant delete on public.invites to authenticated;

-- Create an invite. Returns the token, once: hand it to the invited person (the app sends it by email). Only a person who is not themselves a member may invite.
create or replace function public.create_invite(p_email text, p_role text default 'member', p_can_read_ai boolean default false)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  em text := lower(btrim(coalesce(p_email, '')));
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.members where member = me) then raise exception 'A member cannot invite others'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That does not look like an email address'; end if;
  if p_role not in ('member', 'contributor') then raise exception 'Unknown role'; end if;
  if (select count(*) from public.invites where workspace_owner = me and accepted_at is null and expires_at > now()) >= 20 then raise exception 'Too many invites are waiting. Remove some first.'; end if;
  insert into public.invites (workspace_owner, email, role, can_read_ai, token_hash) values (me, em, p_role, coalesce(p_can_read_ai, false), encode(sha256(convert_to(token, 'UTF8')), 'hex'));
  return token;
end $$;

-- Accept an invite. The caller must be signed in with the email the invite was sent to; the token is single use and expires.
-- Every failure gives the same answer, so a wrong guess learns nothing.
create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  inv public.invites;
begin
  if me is null then raise exception 'Invalid or expired invite'; end if;
  select * into inv from public.invites
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and accepted_at is null and expires_at > now() and email = my_email
   for update;
  if not found then raise exception 'Invalid or expired invite'; end if;
  if inv.workspace_owner = me then raise exception 'Invalid or expired invite'; end if;
  begin
    insert into public.members (workspace_owner, member, role, can_read_ai) values (inv.workspace_owner, me, inv.role, inv.can_read_ai);
  exception when unique_violation or raise_exception then
    raise exception 'Invalid or expired invite';
  end;
  update public.invites set accepted_at = now() where id = inv.id;
  return jsonb_build_object('workspace_owner', inv.workspace_owner, 'role', inv.role, 'can_read_ai', inv.can_read_ai);
end $$;

-- What the caller is: 'admin' (has active members), 'member' or 'contributor' (belongs to a workspace), or 'solo'. For the app and the readers.
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('role', m.role, 'owner', m.workspace_owner, 'can_read_ai', m.can_read_ai, 'active', m.active) from public.members m where m.member = (select auth.uid())),
    (select jsonb_build_object('role', 'admin', 'owner', null, 'can_read_ai', true, 'active', true) where exists (select 1 from public.members m where m.workspace_owner = (select auth.uid()) and m.active)),
    jsonb_build_object('role', 'solo', 'owner', null, 'can_read_ai', true, 'active', true))
$$;

-- Is this person an active member of the caller's workspace? The one question every rule below asks.
create or replace function public.is_my_member(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.members m where m.workspace_owner = (select auth.uid()) and m.member = p_user and m.active)
$$;
-- the same for a storage folder name, which is text
create or replace function public.is_my_member_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.members m where m.workspace_owner = (select auth.uid()) and m.member::text = p_folder and m.active)
$$;

revoke all on function public.create_invite(text, text, boolean), public.accept_invite(text), public.my_access(), public.is_my_member(uuid), public.is_my_member_folder(text) from public, anon;
grant execute on function public.create_invite(text, text, boolean), public.accept_invite(text), public.my_access(), public.is_my_member(uuid), public.is_my_member_folder(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- The data tables: the person's own rows, and the admin's access to their members' rows
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- a row never changes hands: not by a member, and not by the admin
create or replace function public.keep_user_id() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id is distinct from old.user_id then raise exception 'A row cannot be moved to another person'; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts', 'txns', 'receipts', 'statements', 'txn_raw', 'receipt_links', 'link_flags'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_my_member(user_id)) with check (public.is_my_member(user_id))', t || '_admin', t);
    execute format('drop trigger if exists keep_user_id on public.%I', t);
    execute format('create trigger keep_user_id before update on public.%I for each row execute function public.keep_user_id()', t);
  end loop;
  execute 'drop trigger if exists keep_user_id on public.overlays';
  execute 'create trigger keep_user_id before update on public.overlays for each row execute function public.keep_user_id()';
end $$;

-- overlays: the admin reads a member's decisions (to show their data as they categorised it) but never writes them
drop policy if exists overlays_admin_read on public.overlays;
create policy overlays_admin_read on public.overlays for select to authenticated using (public.is_my_member(user_id));

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Original files: the same, folder by folder
-- ---------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare b text;
begin
  foreach b in array array['receipts', 'statements'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_admin_files');
    execute format('create policy %I on storage.objects for all to authenticated using (bucket_id = %L and public.is_my_member_folder((storage.foldername(name))[1])) with check (bucket_id = %L and public.is_my_member_folder((storage.foldername(name))[1]))', b || '_admin_files', b, b);
  end loop;
end $$;
