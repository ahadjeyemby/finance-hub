import { useEffect, useState } from 'react';
import { Linking, TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { sourceWhen } from '@/components/source';
import { NUMBER_KINDS, NUMBER_KIND_LABEL, accountNumbers, parseLast4, whyNotMerge, withNumber, withoutNumber } from '@/core/accounts';
import { dayLabel } from '@/core/dates';
import { dollars } from '@/core/queries';
import type { Account, AccountNumberKind } from '@/core/types';
import { fetchMergedAccounts, fetchStatements, mergeAccounts, saveAccountNumbers, statementFileUrl, unmergeAccount } from '@/data/accounts';
import type { StatementRef } from '@/data/accounts';
import { useRepo } from '@/data/repo';
import { C, F, R, S } from '@/theme/tokens';
import { Banner, Button, Card, Chip, Row, Screen, T } from '@/theme/ui';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Merge this account into another one that is really the same account. Nothing is deleted: its transactions and statements move, and it can be undone. */
function Merge({ account, accounts, txnCount, onDone }: { account: Account; accounts: Account[]; txnCount: number; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = (account.institution || '').toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length > 2) ?? '';
  const options = accounts.filter((a) => !whyNotMerge(account, a)).sort((a, b) => Number(b.institution.toLowerCase().includes(first)) - Number(a.institution.toLowerCase().includes(first)));
  if (!options.length) return null;
  const go = async () => {
    if (!target) return;
    setBusy(true); setError('');
    try {
      const r = await mergeAccounts(account, target);
      onDone(`Merged ${account.name} into ${target.name}: ${r.transactions} transactions and ${r.statements} statements moved. You can undo this at the bottom of the page.`);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  return (
    <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
      <View style={{ flexDirection: 'row' }}><Button small kind="outline" label={open ? 'Cancel merge' : 'Merge into another account'} onPress={() => { setOpen((v) => !v); setTarget(null); setError(''); }} /></View>
      {open ? (
        <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
          <T size={13} bold>Which account is this the same as?</T>
          <T size={12} tone="ink3">{account.name} will be merged into the one you pick, and the one you pick is kept.</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{options.map((a) => <Chip key={a.id} label={a.name} on={target?.id === a.id} onPress={() => setTarget(a)} />)}</View>
          {target ? (
            <View style={{ gap: S.xs }}>
              <T size={13}>{txnCount} transactions and all statements of {account.name} move to {target.name}. {account.name}’s number{accountNumbers(account).length > 1 ? 's' : ''} ({accountNumbers(account).join(', ') || 'none'}) {accountNumbers(account).length > 1 ? 'are' : 'is'} added to {target.name}, so future statements with {accountNumbers(account).length > 1 ? 'them' : 'it'} land there. {account.name} is hidden, not deleted, and you can undo the merge.</T>
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Button small label={busy ? 'Merging' : `Merge into ${target.name}`} disabled={busy} onPress={go} />
                <Button small kind="ghost" label="Cancel" disabled={busy} onPress={() => { setOpen(false); setTarget(null); }} />
              </View>
            </View>
          ) : null}
          {error ? <T size={12} tone="bad">{error}</T> : null}
        </View>
      ) : null}
    </View>
  );
}

/** The statements saved for an account, newest first, each with its balances, whether it added up, and a button that opens the original file. */
function Statements({ accountId, title }: { accountId: string | null; title: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<StatementRef[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && list === null) { try { setList(await fetchStatements(accountId)); } catch (e) { setError((e as Error).message); setList([]); } }
  };
  const openFile = async (s: StatementRef) => {
    setBusy(s.id); setError('');
    try { const url = await statementFileUrl(s.storagePath); if (url) await Linking.openURL(url); else setError('The original file was not stored for this statement.'); } catch (e) { setError((e as Error).message); }
    setBusy('');
  };
  return (
    <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
      <View style={{ flexDirection: 'row' }}><Button small kind="outline" label={open ? `Hide ${title.toLowerCase()}` : `${title}${list ? ` (${list.length})` : ''}`} onPress={toggle} /></View>
      {open && list === null ? <T size={12} tone="ink3">Loading.</T> : null}
      {open && list?.length === 0 && !error ? <T size={12} tone="ink3">No statement is saved for this yet. Import one from Add.</T> : null}
      {open ? list?.map((s) => (
        <View key={s.id} style={{ gap: 2, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
          <T size={13} bold>{s.periodFrom && s.periodTo ? `${dayLabel(s.periodFrom)} to ${dayLabel(s.periodTo)}` : s.label ?? s.id}</T>
          <T size={12} tone="ink2">{s.openingCents != null && s.closingCents != null ? `Opening ${dollars(s.openingCents)}, closing ${dollars(s.closingCents)}` : 'Balances not recorded'}{s.rows != null ? `, ${s.rows} transactions` : ''}{s.pages ? `, ${s.pages} pages` : ''}</T>
          <T size={12} tone={s.reconciled === false ? 'bad' : 'ink3'}>{s.reconciled === true ? 'The rows added up to the printed balances.' : s.reconciled === false ? 'Saved although the rows did not add up to the printed balances.' : 'Whether it added up was not recorded.'}</T>
          {s.sourceFile ? <T size={12} tone="ink3">File: {s.sourceFile}</T> : null}
          <View style={{ flexDirection: 'row' }}><Button small kind="outline" label={busy === s.id ? 'Opening' : s.storagePath ? 'Open the statement' : 'No original stored'} disabled={!s.storagePath || busy === s.id} onPress={() => openFile(s)} /></View>
        </View>
      )) : null}
      {error ? <T size={12} tone="bad">{error}</T> : null}
    </View>
  );
}

/** The numbers that mean this account, and a way to add more: a reissued card, an old account number, a debit or credit card that belongs to it. */
function Numbers({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<AccountNumberKind>('replaced');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (next: Account) => {
    setBusy(true); setError('');
    try { await saveAccountNumbers(account.id, next.extraNumbers ?? []); setText(''); onSaved(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const add = () => {
    const last4 = parseLast4(text);
    if (!last4) return setError('Enter the last four digits.');
    if (last4 === account.last4 || account.extraNumbers?.some((n) => n.last4 === last4)) return setError('That number is already on this account.');
    save(withNumber(account, last4, kind));
  };
  return (
    <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
      <T size={12} tone="ink3">Numbers on this account. Statements and receipts with any of them count as this account.</T>
      <T size={13}>{account.last4 || 'No main number'} (main)</T>
      {(account.extraNumbers ?? []).map((n) => (
        <View key={n.last4} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
          <T size={13}>{n.last4} ({NUMBER_KIND_LABEL[n.kind].toLowerCase()}){n.note ? `, ${n.note}` : ''}</T>
          <Button small kind="ghost" label="Remove" disabled={busy} onPress={() => save(withoutNumber(account, n.last4))} />
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {NUMBER_KINDS.map((k) => <Chip key={k} label={NUMBER_KIND_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
        <TextInput value={text} onChangeText={setText} onSubmitEditing={add} placeholder="Last 4 digits" placeholderTextColor={C.ink3} keyboardType="number-pad" maxLength={12} accessibilityLabel={`Add a number to ${account.name}`}
          style={{ flex: 1, minHeight: 44, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink }} />
        <Button small label="Add number" disabled={busy || !text.trim()} onPress={add} />
      </View>
      {error ? <T size={12} tone="bad">{error}</T> : null}
    </View>
  );
}

export default function Accounts() {
  const { accounts, txns, dataFrom, dataTo, auth, sync, source } = useRepo();
  const span = Math.max(1, daysBetween(dataFrom, dataTo));
  const orphan = txns.filter((t) => t.kind === 'transfer' && t.subtype === 'card_payment' && !t.pairId);
  const cardSide = orphan.filter((t) => accounts.find((a) => a.id === t.accountId)?.type === 'credit');
  const bankSide = orphan.filter((t) => accounts.find((a) => a.id === t.accountId)?.type === 'checking');
  const cardTotal = cardSide.reduce((s, t) => s + t.cents, 0);
  const [merged, setMerged] = useState<Awaited<ReturnType<typeof fetchMergedAccounts>>>([]);
  const [mergeMsg, setMergeMsg] = useState('');
  const [undoError, setUndoError] = useState('');
  const refreshMerged = () => { fetchMergedAccounts().then(setMerged).catch(() => setMerged([])); };
  useEffect(() => { if (auth.configured) refreshMerged(); }, [auth.configured, accounts.length]);
  const incomeOpen = accounts.some((a) => a.type === 'checking' && a.incomeComplete === false);
  return (
    <Screen max={820}>
      <ScreenHeader back title="Accounts and data" sub="What the numbers are built from, and what is missing." />
      <Card title="Sync">
        {auth.configured ? (
          <>
            <Row label="Signed in as" value={auth.email ?? ''} />
            <Row label="Data source" value={`Supabase project ${source.project ?? ''}`} />
            <Row label="Statement data" value={source.kind === 'database' ? `${source.accounts} accounts, ${source.rows} rows, loaded live ${sourceWhen(source.at)}` : source.kind === 'saved' ? `Saved copy from ${sourceWhen(source.at)}, not confirmed` : 'Not loaded'} tone={source.kind === 'saved' ? 'bad' : undefined} />
            <Row label="Status" value={sync.state === 'synced' ? 'Up to date' : sync.state === 'syncing' ? 'Syncing' : sync.state === 'error' ? 'Not synced' : 'Waiting'} tone={sync.state === 'error' ? 'bad' : undefined} />
            {sync.lastAt ? <Row label="Last synced" value={new Date(sync.lastAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} /> : null}
            {sync.error ? <T size={12} tone="bad">{sync.error}. Your changes are saved on this device and will upload when this works.</T> : null}
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <Button small kind="outline" label="Sync now" onPress={sync.now} />
              <Button small kind="ghost" label="Sign out" onPress={auth.signOut} />
            </View>
          </>
        ) : <T size={13} tone="ink2">Not connected to a backend. Your edits are kept on this device only. See the README to connect Supabase.</T>}
      </Card>
      {cardSide.length ? <Banner title={`${dollars(cardTotal)} was paid to your cards from an account that is not connected.`}>{cardSide.length} card payments have no matching withdrawal in the statements here. Add that account’s statements to see where this money came from. It does not count as spending or income either way.</Banner> : null}
      {bankSide.length ? <Banner tone="info" title={`${bankSide.length} withdrawals for card payments have no matching card credit.`}>The card statement for that period is probably missing.</Banner> : null}
      {incomeOpen ? <Banner title="Earned may be low.">Income only counts deposits into connected checking accounts, and not every account that receives money is connected.</Banner> : null}
      {accounts.map((a) => {
        const left = Math.max(0, daysBetween(dataFrom, a.coverage.from)) / span;
        const to = a.type === 'cash' ? dataTo : a.coverage.to < dataTo ? a.coverage.to : dataTo;
        const width = Math.max(0.02, Math.min(1, daysBetween(a.coverage.from > dataFrom ? a.coverage.from : dataFrom, to) / span));
        const n = txns.filter((t) => t.accountId === a.id).length;
        return (
          <Card key={a.id} title={a.name} right={<T size={12} tone="ink3">{a.type}{a.last4 ? ` ${a.last4}` : ''}</T>}>
            <View style={{ height: 10, backgroundColor: C.line, borderRadius: 5, overflow: 'hidden' }}>
              <View style={{ marginLeft: `${left * 100}%`, width: `${width * 100}%`, height: '100%', backgroundColor: C.bar, borderRadius: 5 }} />
            </View>
            <Row label="Statements cover" value={a.type === 'cash' ? 'Entered by you' : `${dayLabel(a.coverage.from)} to ${dayLabel(a.coverage.to)}`} />
            <Row label="Transactions" value={String(n)} />
            {a.type !== 'cash' && auth.configured ? <Statements accountId={a.id} title="Statements" /> : null}
            {a.type !== 'cash' && auth.configured ? <Numbers account={a} onSaved={() => sync.now()} /> : null}
            {a.type !== 'cash' && auth.configured ? <Merge account={a} accounts={accounts} txnCount={n} onDone={(m) => { setMergeMsg(m); sync.now().then(refreshMerged); }} /> : null}
            {a.coverage.to < dataTo && a.type !== 'cash' ? <T size={12} tone="ink3">{daysBetween(a.coverage.to, dataTo)} days behind the newest statement. Totals for those days are incomplete.</T> : null}
          </Card>
        );
      })}
      {mergeMsg ? <Banner tone="info" title={mergeMsg}>{''}</Banner> : null}
      {merged.length ? (
        <Card title="Merged accounts">
          <T size={12} tone="ink3">Hidden, not deleted. Undo puts every transaction and statement back where it came from.</T>
          {merged.map((m) => {
            const into = accounts.find((a) => a.id === m.mergedInto);
            return (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
                <T size={13} style={{ flex: 1 }}>{m.name} ({accountNumbers(m).join(', ')}) was merged into {into?.name ?? m.mergedInto}</T>
                {into ? <Button small kind="outline" label="Undo" onPress={() => { setUndoError(''); unmergeAccount(m, into).then(() => { setMergeMsg(`Undid the merge of ${m.name}.`); return sync.now(); }).then(refreshMerged).catch((e) => setUndoError((e as Error).message)); }} /> : null}
              </View>
            );
          })}
          {undoError ? <T size={12} tone="bad">{undoError}</T> : null}
        </Card>
      ) : null}
      {auth.configured ? <Card title="Not tied to an account"><T size={12} tone="ink3">Statements kept as evidence for an account you do not track.</T><Statements accountId={null} title="Show these statements" /></Card> : null}
      <View style={{ height: S.md }} />
    </Screen>
  );
}
