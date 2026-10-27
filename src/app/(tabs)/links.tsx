import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import type { ReceiptRecord } from '@/core/evidence';
import { learnAliases, linkTrust } from '@/core/learn';
import { CHARGE_NO_LINK, NO_LINK_LABEL, RECEIPT_NO_LINK, orphanLinks, planLinks, storedKeys } from '@/core/links';
import type { Link, NoLinkReason, Proposal } from '@/core/links';
import { dollars } from '@/core/queries';
import type { Txn } from '@/core/types';
import { clearFlag, removeLink, saveLinks, setFlag } from '@/data/links';
import { sweepLinks } from '@/data/linking';
import { useRepo } from '@/data/repo';
import { R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Card, Chip, Screen, T } from '@/theme/ui';
import { useTxPanel } from '@/components/txpanelctx';

const SHOWN = 25;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

export default function Links() {
  const C = useColors();
  const { links, txns, accounts, reloadLinks } = useRepo();
  const { openTxn } = useTxPanel();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pick, setPick] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [more, setMore] = useState({ receipts: SHOWN, charges: SHOWN, linked: SHOWN });

  const plan = useMemo(() => {
    if (!links) return null;
    const keys = storedKeys(links);
    return planLinks({ receipts: links.receipts, txns, links: links.links, flags: links.flags, accounts, aliases: learnAliases(keys, txns), trust: linkTrust(keys, txns, accounts) });
  }, [links, txns, accounts]);

  const receiptById = useMemo(() => new Map((links?.receipts ?? []).map((r) => [r.id, r])), [links]);
  const txnById = useMemo(() => new Map(txns.map((t) => [t.id, t])), [txns]);
  const acct = (t: Txn) => { const a = accounts.find((x) => x.id === t.accountId); return a ? (a.last4 ? `${a.institution} ${a.last4}` : a.name) : t.accountId; };
  const rLabel = (r: ReceiptRecord) => `${r.merchant ?? 'Receipt'}, ${r.date ?? 'no date'}, ${r.totalCents != null ? dollars(r.totalCents) : 'no total'}${r.cardLast4 ? `, card ${r.cardLast4}` : ''}`;
  const tLabel = (t: Txn) => `${t.merchant}, ${t.date}, ${dollars(-t.cents)}, ${acct(t)}`;

  const act = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); await reloadLinks(); if (done) setMsg(done); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const confirm = (p: Proposal) => act(() => saveLinks([{ receiptId: p.receiptId, txnId: p.txnId, role: p.role, method: 'confirmed', reason: p.reason, confirmed: true }]), 'Linked.');
  const choose = (receiptId: string, txnId: string) => act(async () => { await saveLinks([{ receiptId, txnId, role: 'primary', method: 'manual', reason: 'chosen by you', confirmed: true }]); setPick(null); }, 'Linked.');
  const flagReceipt = (id: string, reason: NoLinkReason) => act(async () => { await setFlag('receipt', id, reason); setFlagging(null); }, `Marked: ${NO_LINK_LABEL[reason].toLowerCase()}.`);
  const flagCharge = (id: string, reason: NoLinkReason) => act(async () => { await setFlag('txn', id, reason); setFlagging(null); }, `Marked: ${NO_LINK_LABEL[reason].toLowerCase()}.`);
  const find = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await sweepLinks(txns, accounts);
      if (!r) setError('Links are not available. Run migration 0003 in Supabase, then sync.');
      else { await reloadLinks(); setMsg(r.saved || r.suggested ? `Linked ${r.saved} automatically. ${r.suggested} more to confirm below.` : 'Nothing new to link.'); }
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  if (!links || !plan) {
    return (
      <Screen max={820}>
        <ScreenHeader back title="Links" sub="Which receipt belongs to which charge." />
        <Banner title="Links are not available yet.">Run migration 0003_links.sql in the Supabase SQL editor, then sync. Until then receipts are saved but not linked.</Banner>
      </Screen>
    );
  }

  const suggestions = plan.proposals.filter((p) => !p.sure && !dismissed.has(`${p.receiptId}:${p.txnId}`));
  const stored = links.links.filter((l) => txnById.has(l.txnId) && receiptById.has(l.receiptId));
  const orphans = orphanLinks(links.links, txns);
  const flaggedReceipts = links.flags.filter((f) => f.kind === 'receipt' && receiptById.has(f.refId));
  const flaggedCharges = links.flags.filter((f) => f.kind === 'txn' && txnById.has(f.refId));
  const unlinkedReceipts = plan.receiptsWithoutCharge;
  const bareCharges = plan.chargesWithoutReceipt.map((id) => txnById.get(id)!).filter(Boolean).sort((a, b) => a.cents - b.cents);

  const flagButtons = (key: string, reasons: NoLinkReason[], on: (r: NoLinkReason) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {reasons.map((r) => <Chip key={r} label={NO_LINK_LABEL[r]} onPress={() => on(r)} />)}
      <Button small kind="ghost" label="Cancel" onPress={() => setFlagging(null)} />
    </View>
  );

  return (
    <Screen max={820}>
      <ScreenHeader back title="Links" sub="Which receipt belongs to which charge. Anything not linked is flagged here, unless you said no link is expected."
        right={<Button small label={busy ? 'Working' : 'Find matches'} disabled={busy} onPress={find} />} />
      {msg ? <Banner title={msg}>{''}</Banner> : null}
      {error ? <Banner title="That did not work">{error}</Banner> : null}
      {orphans.length ? (
        <Banner title={`${orphans.length} link${orphans.length > 1 ? 's point' : ' points'} at charges that are no longer in your ledger`}>
          This happens after a wipe and reimport. Remove them and press Find matches to link again.
        </Banner>
      ) : null}
      {orphans.length ? <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="Remove those links" disabled={busy} onPress={() => act(async () => { for (const l of orphans) await removeLink(l.receiptId, l.txnId); }, 'Removed.')} /></View> : null}

      <Card title="Summary">
        <T size={13} tone="ink2">{stored.length} linked. {suggestions.length} to confirm. {unlinkedReceipts.length} receipt{unlinkedReceipts.length === 1 ? '' : 's'} not linked. {bareCharges.length} charge{bareCharges.length === 1 ? '' : 's'} without a receipt. {flaggedReceipts.length + flaggedCharges.length} marked as no link expected.</T>
      </Card>

      {suggestions.length ? (
        <Card title={`Looks like a match (${suggestions.length})`}>
          <T size={12} tone="ink3">Likely, not certain. Confirm the ones that are right.</T>
          {suggestions.map((p) => {
            const r = receiptById.get(p.receiptId); const t = txnById.get(p.txnId);
            if (!r || !t) return null;
            return (
              <View key={`${p.receiptId}:${p.txnId}`} style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
                <T size={13} bold>{rLabel(r)}</T>
                <T size={13} tone="ink2">with the charge {tLabel(t)}</T>
                <T size={12} tone="ink3">{p.reason}</T>
                <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                  <Button small label="Yes, link them" disabled={busy} onPress={() => confirm(p)} />
                  <Button small kind="ghost" label="Not this one" onPress={() => setDismissed((d) => new Set([...d, `${p.receiptId}:${p.txnId}`]))} />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card title={`Receipts not linked (${unlinkedReceipts.length})`}>
        {!unlinkedReceipts.length ? <T size={13} tone="ink2">Every receipt is linked or marked.</T> : null}
        {unlinkedReceipts.slice(0, more.receipts).map((u) => {
          const r = receiptById.get(u.receiptId); if (!r) return null;
          const nearby = r.date ? txns.filter((t) => (t.kind === 'spend' || t.kind === 'fee') && !t.manual && !t.receiptId && dayGap(t.date, r.date!) <= 14)
            .sort((a, b) => Math.abs(-a.cents - (r.totalCents ?? 0)) - Math.abs(-b.cents - (r.totalCents ?? 0)) || dayGap(a.date, r.date!) - dayGap(b.date, r.date!)).slice(0, 6) : [];
          return (
            <View key={u.receiptId} style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
              <T size={13} bold>{rLabel(r)}</T>
              <T size={12} tone="ink3">{u.text}</T>
              <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                <Button small kind="outline" label={pick === u.receiptId ? 'Hide charges' : 'Choose a charge'} onPress={() => setPick(pick === u.receiptId ? null : u.receiptId)} />
                <Button small kind="outline" label="Paid another way" onPress={() => setFlagging(flagging === `r:${u.receiptId}` ? null : `r:${u.receiptId}`)} />
              </View>
              {flagging === `r:${u.receiptId}` ? flagButtons(u.receiptId, RECEIPT_NO_LINK, (reason) => flagReceipt(u.receiptId, reason)) : null}
              {pick === u.receiptId ? (
                <View style={{ gap: 4 }}>
                  {nearby.length ? nearby.map((t) => <Button key={t.id} small kind="outline" label={tLabel(t)} disabled={busy} onPress={() => choose(u.receiptId, t.id)} />) : <T size={12} tone="ink3">No charge without a receipt within 14 days of this receipt.</T>}
                </View>
              ) : null}
            </View>
          );
        })}
        {unlinkedReceipts.length > more.receipts ? <Button small kind="ghost" label={`Show more (${unlinkedReceipts.length - more.receipts} left)`} onPress={() => setMore((m) => ({ ...m, receipts: m.receipts + SHOWN }))} /> : null}
      </Card>

      <Card title={`Charges without a receipt (${bareCharges.length})`}>
        <T size={12} tone="ink3">Largest first. Charges you entered by hand, and refunds, are not listed.</T>
        {bareCharges.slice(0, more.charges).map((t) => (
          <View key={t.id} style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
            <T size={13} bold>{tLabel(t)}</T>
            <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
              <Button small kind="outline" label="No receipt expected" onPress={() => setFlagging(flagging === `t:${t.id}` ? null : `t:${t.id}`)} />
            </View>
            {flagging === `t:${t.id}` ? flagButtons(t.id, CHARGE_NO_LINK, (reason) => flagCharge(t.id, reason)) : null}
          </View>
        ))}
        {bareCharges.length > more.charges ? <Button small kind="ghost" label={`Show more (${bareCharges.length - more.charges} left)`} onPress={() => setMore((m) => ({ ...m, charges: m.charges + SHOWN }))} /> : null}
      </Card>

      {flaggedReceipts.length || flaggedCharges.length ? (
        <Card title="Marked as no link expected">
          {flaggedReceipts.map((f) => { const r = receiptById.get(f.refId)!; return (
            <View key={`r${f.refId}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
              <View style={{ flex: 1 }}><T size={13}>{rLabel(r)}</T><T size={12} tone="ink3">{NO_LINK_LABEL[f.reason]}</T></View>
              <Button small kind="ghost" label="Undo" disabled={busy} onPress={() => act(() => clearFlag('receipt', f.refId))} />
            </View>); })}
          {flaggedCharges.map((f) => { const t = txnById.get(f.refId)!; return (
            <View key={`t${f.refId}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
              <View style={{ flex: 1 }}><T size={13}>{tLabel(t)}</T><T size={12} tone="ink3">{NO_LINK_LABEL[f.reason]}</T></View>
              <Button small kind="ghost" label="Undo" disabled={busy} onPress={() => act(() => clearFlag('txn', f.refId))} />
            </View>); })}
        </Card>
      ) : null}

      <Card title={`Linked (${stored.length})`}>
        {stored.slice(0, more.linked).map((l: Link) => {
          const r = receiptById.get(l.receiptId)!; const t = txnById.get(l.txnId)!;
          return (
            <View key={`${l.receiptId}:${l.txnId}`} style={{ gap: 2, borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: S.sm }}>
              <T size={13} bold>{rLabel(r)}</T>
              <T size={13} tone="ink2">{l.role === 'extra' ? 'extra document for ' : ''}{tLabel(t)}</T>
              <T size={12} tone="ink3">{l.confirmed ? 'Confirmed by you' : 'Linked automatically'}{l.reason ? `: ${l.reason}` : ''}</T>
              <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                {!l.confirmed ? <Button small kind="outline" label="Confirm" disabled={busy} onPress={() => act(() => saveLinks([{ ...l, confirmed: true }]))} /> : null}
                <Button small kind="ghost" label="Unlink" disabled={busy} onPress={() => act(() => removeLink(l.receiptId, l.txnId), 'Unlinked.')} />
                <Button small kind="ghost" label="Open charge" onPress={() => openTxn(l.txnId)} />
              </View>
            </View>
          );
        })}
        {stored.length > more.linked ? <Button small kind="ghost" label={`Show more (${stored.length - more.linked} left)`} onPress={() => setMore((m) => ({ ...m, linked: m.linked + SHOWN }))} /> : null}
      </Card>
    </Screen>
  );
}
