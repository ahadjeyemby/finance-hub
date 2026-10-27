import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { dayLabel } from '@/core/dates';
import { ROLE_HELP, ROLE_LABEL, canManage, extractToken, isMemberRole, memberName, memberNotice, pendingInvites, visibilityNotice } from '@/core/workspace';
import type { Access, Invite, Member } from '@/core/workspace';
import { useRepo } from '@/data/repo';
import { acceptInvite, endMembership, inviteMember, listInvites, listMembers, myAccess, revokeInvite, setPassword, updateMember } from '@/data/workspace';
import type { InviteResult } from '@/data/workspace';
import { R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Card, Chip, Screen, T, useInputStyle } from '@/theme/ui';

const ROLES = ['member', 'contributor'] as const;

/**
 * Who shares this workspace. The person who manages it invites others and sees, adds and changes what their members hold; a member sees only their
 * own data and is told so here. Every rule is enforced by the database: this screen only asks for things and shows what it allows.
 */
export default function People() {
  const C = useColors();
  const input = useInputStyle();
  const { auth } = useRepo();
  const params = useLocalSearchParams<{ token?: string }>();
  const [access, setAccess] = useState<Access | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // invite form
  const [email, setEmail] = useState(''); const [role, setRole] = useState<'member' | 'contributor'>('member'); const [ai, setAi] = useState(false);
  const [sent, setSent] = useState<InviteResult | null>(null);
  // joining
  const [typed, setTyped] = useState<string | null>(null);
  const code = typed ?? (typeof params.token === 'string' ? params.token : '');
  const setCode = (v: string) => setTyped(v);
  // password and member names
  const [pw, setPw] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState('');

  // what the database says about this person, their members and their invites
  const fetchAll = useCallback(async () => {
    const a = await myAccess();
    let m: Member[] = [], i: Invite[] = [], err = '';
    try { if (a) { m = await listMembers(); i = canManage(a) ? await listInvites() : []; } } catch (e) { err = (e as Error).message; }
    return { a, m, i, err };
  }, []);
  const apply = (r: Awaited<ReturnType<typeof fetchAll>>) => { setAccess(r.a); setMembers(r.m); setInvites(r.i); if (r.err) setError(r.err); setLoaded(true); };
  useEffect(() => {
    let alive = true;
    fetchAll().then((r) => { if (alive) apply(r); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAll]);

  const run = async (fn: () => Promise<void>, done = '') => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (done) setNotice(done); apply(await fetchAll()); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const manage = canManage(access);
  const member = isMemberRole(access);
  const waiting = pendingInvites(invites);
  const token = extractToken(code);

  return (
    <Screen max={820}>
      <ScreenHeader back title="People" sub="Who shares this workspace, and what each person can see." />
      {!loaded ? <T size={13} tone="ink2">Loading</T> : null}
      {loaded && !access ? <Banner title="Workspaces are not set up on this backend yet.">Run the database updates 0006 and 0007 (supabase db push), then come back.</Banner> : null}
      {notice ? <T size={13} tone="good">{notice}</T> : null}
      {error ? <T size={13} tone="bad">{error}</T> : null}

      {member && access ? (
        <Card title="Your workspace">
          <T size={14}>{memberNotice(access.role)} <T size={14} bold>The person who manages it can see, add, change and delete everything you add.</T></T>
          <T size={13} tone="ink2">{access.active ? (access.can_read_ai ? 'You may use the AI readers.' : 'The AI readers are switched off for you.') : access.role === 'contributor' ? 'Your access is paused. Ask the person who manages the workspace to turn it back on.' : 'Your access is paused. You still have your own data, and the person who manages the workspace cannot see it while it is paused.'}</T>
          {confirm === 'leave' ? (
            <View style={{ gap: S.xs }}>
              <T size={13} tone="bad">Leave this workspace? Your data stays yours. They will no longer see it, and you can only rejoin with a new invite.</T>
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Button small kind="outline" label="Yes, leave" disabled={busy} onPress={() => run(async () => { if (auth.userId) await endMembership(auth.userId); setConfirm(''); }, 'You left the workspace.')} />
                <Button small kind="ghost" label="Stay" onPress={() => setConfirm('')} />
              </View>
            </View>
          ) : <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Leave this workspace" onPress={() => setConfirm('leave')} /></View>}
        </Card>
      ) : null}

      {manage ? (
        <>
          <Card title={`Members (${members.length})`}>
            {!members.length ? <T size={13} tone="ink2">Nobody yet. Invite your wife, a business partner or an accountant below. Each person keeps their own data; you can see all of it.</T> : null}
            {members.map((m) => (
              <View key={m.member} style={{ gap: S.xs, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, opacity: m.active ? 1 : 0.6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
                  <T size={15} bold style={{ flex: 1 }}>{memberName(m)}</T>
                  <T size={12} tone="ink3">{m.active ? ROLE_LABEL[m.role] : `${ROLE_LABEL[m.role]}, paused`}</T>
                </View>
                {m.email && m.label ? <T size={12} tone="ink3">{m.email}</T> : null}
                <T size={12} tone="ink3">Joined {dayLabel(m.created_at.slice(0, 10))}. {ROLE_HELP[m.role]}</T>
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {ROLES.map((r) => <Chip key={r} label={ROLE_LABEL[r]} on={m.role === r} onPress={() => m.role !== r && run(() => updateMember(m.member, { role: r }))} />)}
                  <Chip label="Can use AI readers" on={m.can_read_ai} onPress={() => run(() => updateMember(m.member, { can_read_ai: !m.can_read_ai }))} />
                </View>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TextInput value={names[m.member] ?? m.label ?? ''} onChangeText={(v) => setNames({ ...names, [m.member]: v })} placeholder="A name for them, for example Sam" placeholderTextColor={C.ink3} accessibilityLabel="Name for this member" style={[input, { flex: 1 }]} />
                  <Button small kind="outline" label="Save name" disabled={busy || (names[m.member] ?? m.label ?? '') === (m.label ?? '')} onPress={() => run(() => updateMember(m.member, { label: (names[m.member] ?? '').trim() || null }))} />
                </View>
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                  <Button small kind="ghost" label={m.active ? 'Pause access' : 'Resume access'} disabled={busy} onPress={() => run(() => updateMember(m.member, { active: !m.active }))} />
                  {confirm === m.member ? (
                    <>
                      <Button small kind="outline" label="Yes, remove them" disabled={busy} onPress={() => run(async () => { await endMembership(m.member); setConfirm(''); }, 'Removed. Their data stays theirs; you no longer see it.')} />
                      <Button small kind="ghost" label="Keep" onPress={() => setConfirm('')} />
                    </>
                  ) : <Button small kind="ghost" label="Remove" onPress={() => setConfirm(m.member)} />}
                </View>
              </View>
            ))}
          </Card>

          {waiting.length ? (
            <Card title={`Invites waiting (${waiting.length})`}>
              {waiting.map((i) => (
                <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm, alignItems: 'center' }}>
                  <T size={13} style={{ flex: 1 }}>{i.email} · {ROLE_LABEL[i.role]} · expires {dayLabel(i.expires_at.slice(0, 10))}</T>
                  <Button small kind="ghost" label="Cancel" disabled={busy} onPress={() => run(() => revokeInvite(i.id))} />
                </View>
              ))}
              <T size={12} tone="ink3">A cancelled invite can no longer be used, even with its link.</T>
            </Card>
          ) : null}

          <Card title="Invite someone">
            <TextInput value={email} onChangeText={setEmail} placeholder="Their email address" placeholderTextColor={C.ink3} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="Email address to invite" style={input} />
            <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {ROLES.map((r) => <Chip key={r} label={ROLE_LABEL[r]} on={role === r} onPress={() => setRole(r)} />)}
              <Chip label="Can use AI readers" on={ai} onPress={() => setAi(!ai)} />
            </View>
            <T size={12} tone="ink3">{visibilityNotice(role, ai)}</T>
            <View style={{ flexDirection: 'row' }}>
              <Button label="Send invite" disabled={busy || !email.trim()} onPress={() => run(async () => { setSent(await inviteMember(email, role, ai)); setEmail(''); })} />
            </View>
            {sent ? (
              <View style={{ gap: 2, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
                <T size={13} bold>{sent.emailed ? 'The invite was emailed.' : 'Invite created.'}</T>
                {sent.note ? <T size={13} tone="ink2">{sent.note}</T> : null}
                {sent.link ? <T size={12} tone="ink2" style={{ userSelect: 'all' } as never}>Link: {sent.link}</T> : null}
                <T size={12} tone="ink2" style={{ userSelect: 'all' } as never}>Code: {sent.token}</T>
                <T size={12} tone="ink3">Shown once. The person must sign in with the address above to use it, and it works once, within 7 days.</T>
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      {!member ? (
        <Card title="Join someone else's workspace">
          <T size={13} tone="ink2">Paste the link or code from your invite. You must be signed in with the email address it was sent to{auth.email ? ` (you are signed in as ${auth.email})` : ''}.</T>
          {params.token ? <T size={13} bold>You opened an invite link. Press Join to accept it.</T> : null}
          {manage && members.length > 0 ? <T size={12} tone="ink3">You manage a workspace with members, so you cannot join another. Remove your members first.</T> : null}
          <TextInput value={code} onChangeText={setCode} placeholder="Invite link or code" placeholderTextColor={C.ink3} autoCapitalize="none" accessibilityLabel="Invite link or code" style={input} />
          <View style={{ flexDirection: 'row' }}>
            <Button label="Join" disabled={busy || !token} onPress={() => run(async () => { await acceptInvite(token!); setCode(''); }, 'You joined the workspace. The person who manages it can now see what you add.')} />
          </View>
          {code.trim() && !token ? <T size={12} tone="bad">That does not look like an invite link or code.</T> : null}
        </Card>
      ) : null}

      <Card title="Password">
        <T size={13} tone="ink2">If you signed in from an invite email, your account has no password yet. Choose one so you can sign in next time.</T>
        <TextInput value={pw} onChangeText={setPw} placeholder="New password (at least 8 characters)" placeholderTextColor={C.ink3} secureTextEntry accessibilityLabel="New password" style={input} />
        <View style={{ flexDirection: 'row' }}>
          <Button kind="outline" label="Set password" disabled={busy || pw.length < 8} onPress={() => run(async () => { await setPassword(pw); setPw(''); }, 'Password set.')} />
        </View>
      </Card>
      <View style={{ height: S.md }} />
    </Screen>
  );
}
