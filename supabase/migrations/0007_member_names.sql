-- Audit: show members by name. Run after 0006. Safe to run twice. Moves no data.
-- The admin sees a member as an email address and a label they choose ("Sam", "Accountant"). The email comes from the invite the member accepted,
-- so the admin never needs read access to the auth users table. Only the label can be changed, and only by the admin.

alter table public.members add column if not exists email text;
alter table public.members add column if not exists label text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_label_len') then
    alter table public.members add constraint members_label_len check (label is null or char_length(label) <= 60);
  end if;
end $$;

-- fill in the address for anyone who joined before this migration
update public.members m set email = lower(u.email) from auth.users u where u.id = m.member and m.email is null;

grant update (label) on public.members to authenticated;   -- with role, can_read_ai and active from 0006; the admin-only update policy still applies

-- accept_invite as in 0006, now also keeping the member's address
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
    insert into public.members (workspace_owner, member, role, can_read_ai, email) values (inv.workspace_owner, me, inv.role, inv.can_read_ai, my_email);
  exception when unique_violation or raise_exception then
    raise exception 'Invalid or expired invite';
  end;
  update public.invites set accepted_at = now() where id = inv.id;
  return jsonb_build_object('workspace_owner', inv.workspace_owner, 'role', inv.role, 'can_read_ai', inv.can_read_ai);
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
