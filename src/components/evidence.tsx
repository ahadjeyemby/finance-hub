import { Image } from 'expo-image';
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { categoryLabel } from '@/core/categories';
import { dollars } from '@/core/queries';
import { formatStamp } from '@/core/sync';
import type { Txn } from '@/core/types';
import { fetchEvidence } from '@/data/evidence';
import type { Evidence } from '@/data/evidence';
import { C, F, R, S } from '@/theme/tokens';
import { Button, H, T } from '@/theme/ui';

const cents = (c: number | null | undefined) => (c == null ? '' : dollars(c));

function Field({ label, value }: { label: string; value?: string | null }) {
  if (value == null || value === '') return null;
  return (
    <View style={{ flexDirection: 'row', gap: S.md, paddingVertical: 3 }}>
      <Text style={{ width: 130, fontFamily: F.body, fontSize: 13, color: C.ink3 }}>{label}</Text>
      <Text selectable style={{ flex: 1, fontFamily: F.bodyMed, fontSize: 13, color: C.ink }}>{value}</Text>
    </View>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={{ backgroundColor: C.ground, borderRadius: R.md, padding: S.md, gap: 2 }}><H size={15} style={{ marginBottom: 4 }}>{title}</H>{children}</View>;
}
const open = (url: string | null) => { if (url) Linking.openURL(url).catch(() => {}); };

/** How a transaction got into the ledger, with the document behind it. */
export function originOf(t: Txn, ev: Evidence | null): string {
  if (t.manual) return t.receiptId ? 'Entered by hand from an uploaded receipt' : 'Entered by hand';
  if (ev?.receipts.length) return ev.raw ? 'Bank or card statement, matched to an uploaded receipt' : 'Matched to an uploaded receipt';
  return 'Bank or card statement';
}

function Body({ t, ev, loading }: { t: Txn; ev: Evidence | null; loading: boolean }) {
  const isImage = (p: string | null) => !!p && /\.(jpe?g|png|webp)$/i.test(p);
  return (
    <View style={{ gap: S.md }}>
      <Section title="How it was entered">
        <T size={14} bold>{originOf(t, ev)}</T>
        {loading ? <T size={12} tone="ink3">Loading the stored documents</T> : null}
        {ev && !ev.online && !t.manual ? <T size={12} tone="ink3">Source documents load from your database. They could not be reached, so only what is on this device is shown.</T> : null}
      </Section>

      {t.manual ? (
        <Section title="Entry details">
          <Field label="Purchase date" value={t.date} />
          <Field label="Entered" value={t.createdAt ? formatStamp(t.createdAt) : 'Not recorded (entered before timestamps were kept)'} />
          <Field label="Uploaded" value={t.uploadedAt ? formatStamp(t.uploadedAt) : 'Not uploaded yet. It stays on this device until you are signed in and online.'} />
          <Field label="Amount" value={dollars(t.cents, { sign: true })} />
          <Field label="Paid to" value={t.merchant} />
          <Field label="What for" value={t.description} />
          <Field label="Category" value={categoryLabel(t.category)} />
          <Field label="Business or personal" value={t.business ? 'Business' : 'Personal'} />
          <Field label="Repeats" value={t.oneOff ? 'One-time' : 'Normal'} />
          <Field label="Note" value={t.note} />
          <Field label="Entry id" value={t.id} />
          {t.lines?.length ? <View style={{ marginTop: 6 }}>{t.lines.map((l, i) => <Field key={i} label={i === 0 ? 'Items' : ''} value={`${l.item}  ${dollars(l.cents)}`} />)}</View> : null}
        </Section>
      ) : null}

      {!t.manual && ev?.raw ? (
        <Section title="Statement line">
          <Field label="Statement" value={ev.statement?.label ?? ev.raw.statementId} />
          {ev.statement ? <Field label="Period" value={[ev.statement.periodFrom, ev.statement.periodTo].filter(Boolean).join(' to ')} /> : null}
          {ev.statement ? <Field label="Balance" value={ev.statement.openingCents != null || ev.statement.closingCents != null ? `${cents(ev.statement.openingCents)} to ${cents(ev.statement.closingCents)}` : ''} /> : null}
          {ev.statement?.reconciled != null ? <Field label="Statement totals" value={ev.statement.reconciled ? 'Extracted rows match the printed totals' : 'Do not match the printed totals'} /> : null}
          <Field label="Line number" value={ev.raw.lineNo != null ? String(ev.raw.lineNo) : ''} />
          <Field label="Posted" value={ev.raw.postedDate} />
          <Field label="File" value={ev.statement?.sourceFile ?? ev.raw.sourceFile} />
          {Object.entries(ev.raw.row).map(([k, v]) => <Field key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')} />)}
          {ev.statement?.url ? <Button small kind="outline" label="Open the statement" onPress={() => open(ev.statement!.url)} style={{ marginTop: 6, alignSelf: 'flex-start' }} /> : null}
        </Section>
      ) : null}
      {!t.manual && ev && ev.online && !ev.raw ? (
        <Section title="Statement line"><T size={13} tone="ink2">No source line is stored for this transaction yet. Run bun run ledger:upload to store it.</T><Field label="Source" value={t.source} /><Field label="As printed" value={t.description} />{t.ref ? <Field label="Reference" value={t.ref} /> : null}</Section>
      ) : null}

      {ev?.receipts.map((r) => (
        <Section key={r.id} title={`Receipt${r.merchant ? `: ${r.merchant}` : ''}`}>
          <Field label="Uploaded" value={formatStamp(r.uploadedAt)} />
          <Field label="Taken" value={r.capturedAt ? formatStamp(r.capturedAt) : ''} />
          <Field label="Receipt date" value={[r.date, r.time].filter(Boolean).join(' ')} />
          <Field label="Total" value={cents(r.totalCents)} />
          <Field label="Subtotal" value={cents(r.subtotalCents)} />
          <Field label="Tax" value={cents(r.taxCents)} />
          <Field label="Tip" value={cents(r.tipCents)} />
          <Field label="Discount" value={cents(r.discountCents)} />
          <Field label="Paid with" value={[r.paymentMethod, r.cardLast4 ? `ending ${r.cardLast4}` : ''].filter(Boolean).join(' ')} />
          <Field label="Store" value={[r.storeAddress, r.storeRef].filter(Boolean).join(', ')} />
          <Field label="Order" value={r.orderRef} />
          <Field label="Read from" value={r.origin === 'typed' ? 'Typed in by hand' : r.origin === 'offline_extract' ? 'A document file' : 'An uploaded photo'} />
          {r.lines.length ? <View style={{ marginTop: 6 }}>{r.lines.map((l, i) => <Field key={i} label={i === 0 ? 'Items' : ''} value={`${l.item}${l.qty && l.qty !== 1 ? ` x${l.qty}` : ''}${l.code ? ` (${l.code})` : ''}  ${cents(l.cents)}`} />)}</View> : null}
          {r.url && isImage(r.storagePath) ? <Image source={{ uri: r.url }} style={{ width: '100%', height: 260, borderRadius: R.sm, marginTop: 6 }} contentFit="contain" accessibilityLabel="Receipt image" /> : null}
          {r.url ? <Button small kind="outline" label="Open the original" onPress={() => open(r.url)} style={{ marginTop: 6, alignSelf: 'flex-start' }} /> : null}
        </Section>
      ))}
      {!t.manual && ev && ev.online && !ev.receipts.length ? <Section title="Receipt"><T size={13} tone="ink2">No receipt is attached to this transaction.</T></Section> : null}
    </View>
  );
}

/** A card on the transaction screen that opens the evidence pop-up. */
export function EvidenceCard({ txn }: { txn: Txn }) {
  const [shown, setShown] = useState(false);
  const [ev, setEv] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(false);
  // loaded when the pop-up opens, every time, so it always reflects what the database holds now
  const show = () => {
    setShown(true); setLoading(true); setEv(null);
    fetchEvidence(txn).then((e) => { setEv(e); setLoading(false); });
  };

  return (
    <View style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.lg, gap: S.sm }}>
      <H size={16}>Evidence</H>
      <T size={13} tone="ink2">{originOf(txn, null)}.</T>
      <Button kind="outline" label="Show evidence" onPress={show} style={{ alignSelf: 'flex-start' }} />
      <Modal visible={shown} animationType="slide" transparent onRequestClose={() => setShown(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Pressable accessibilityLabel="Close" onPress={() => setShown(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 640, maxHeight: '90%', backgroundColor: C.paper, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: S.lg, gap: S.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
              <H size={18}>{txn.merchant}, {dollars(txn.cents, { sign: true })}</H>
              <Button small kind="ghost" label="Close" onPress={() => setShown(false)} />
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: S.lg }}><Body t={txn} ev={ev} loading={loading} /></ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
