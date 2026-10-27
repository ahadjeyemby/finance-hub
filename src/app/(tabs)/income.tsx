import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { RedactReview } from '@/components/redact';
import { dayLabel, monthLabel } from '@/core/dates';
import { INCOME_TYPES, INCOME_TYPE_LABEL, assignDeposit, matchAll, newIncomeId, parseWords, recordIssues, removeRecord, removeSource, saveRecord, saveSource, summarizeIncome } from '@/core/income';
import type { IncomeType, PayRecord } from '@/core/income';
import { draftFromRead, provenance } from '@/core/payslip';
import type { PayslipDraft } from '@/core/payslip';
import { dollars } from '@/core/queries';
import { findSensitive, parseHideWords, withNewSearch } from '@/core/redact';
import type { RedactBox } from '@/core/redact';
import { pickFiles } from '@/data/intake';
import type { PickedFile } from '@/data/intake';
import { readPayslipFile } from '@/data/payslip';
import { burnRedactions, discardScan, redactionSupported, scanForRedaction } from '@/data/redact';
import type { Scan } from '@/data/redact';
import { useRedactSettings } from '@/data/redactSettings';
import { useRepo } from '@/data/repo';
import { R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Card, Chip, Screen, T, useInputStyle } from '@/theme/ui';
import { ownerOnly } from '@/components/owneronly';

const cents = (text: string) => Math.round(Number(text.replace(/[$,\s]/g, '')) * 100);
const GROUPS = [{ id: 'insurance', label: 'Insurance' }, { id: 'retirement', label: 'Retirement' }, { id: 'other', label: 'Other' }] as const;

interface Line { label: string; amount: string; group?: 'insurance' | 'retirement' | 'other'; last4?: string }

function Field({ value, onChange, placeholder, label, wide }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; wide?: boolean }) {
  const C = useColors();
  const input = useInputStyle();
  return <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.ink3} accessibilityLabel={label} style={[input, { flex: wide ? 2 : 1, minWidth: wide ? 140 : 90 }]} />;
}

/** Rows of label and amount (and, for deductions, a kind; for deposits, an account's last four digits). */
function Lines({ title, lines, onChange, kind }: { title: string; lines: Line[]; onChange: (next: Line[]) => void; kind: 'tax' | 'deduction' | 'deposit' }) {
  const set = (i: number, over: Partial<Line>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...over } : l)));
  return (
    <View style={{ gap: 4 }}>
      <T size={13} bold>{title}</T>
      {lines.map((l, i) => (
        <View key={i} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            {kind === 'deposit'
              ? <Field value={l.last4 ?? ''} onChange={(v) => set(i, { last4: v.replace(/\D/g, '').slice(0, 4) })} placeholder="Account last 4" label="Account last four digits" />
              : <Field wide value={l.label} onChange={(v) => set(i, { label: v })} placeholder={kind === 'tax' ? 'For example Federal income tax' : 'For example Medical pre-tax'} label="Name" />}
            <Field value={l.amount} onChange={(v) => set(i, { amount: v })} placeholder="Amount" label="Amount" />
            <Button small kind="ghost" label="Remove" onPress={() => onChange(lines.filter((_, k) => k !== i))} />
          </View>
          {kind === 'deduction' ? <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>{GROUPS.map((g) => <Chip key={g.id} label={g.label} on={(l.group ?? 'other') === g.id} onPress={() => set(i, { group: g.id })} />)}</View> : null}
        </View>
      ))}
      <View style={{ flexDirection: 'row' }}><Button small kind="outline" label={kind === 'deposit' ? 'Add a deposit' : kind === 'tax' ? 'Add a tax' : 'Add a deduction'} onPress={() => onChange([...lines, { label: '', amount: '', group: 'other' }])} /></View>
    </View>
  );
}

/**
 * Where money comes from and what was taken out of it. Income deposits come from the statements; the person says which source each belongs to,
 * and pay records (a paycheck's gross, taxes, deductions and net) are checked to add up and matched to the deposits they name.
 */
export default ownerOnly(Income);

function Income() {
  const C = useColors();
  const input = useInputStyle();
  const { txns, accounts, income, saveIncome, links, months, period, setPeriod, range } = useRepo();
  const receipts = useMemo(() => (links?.receipts ?? []).map((r) => ({ date: r.date ?? null, taxCents: r.taxCents ?? null })), [links]);
  const sum = useMemo(() => summarizeIncome(txns, accounts, income, range, receipts), [txns, accounts, income, range, receipts]);
  const matches = useMemo(() => matchAll(income.records, txns, accounts), [income.records, txns, accounts]);
  const [notice, setNotice] = useState('');

  // new source
  const [srcName, setSrcName] = useState(''); const [srcType, setSrcType] = useState<IncomeType>('salary'); const [srcWords, setSrcWords] = useState('');
  // new pay record
  const [open, setOpen] = useState(false);
  const [srcId, setSrcId] = useState(''); const [date, setDate] = useState(''); const [gross, setGross] = useState(''); const [net, setNet] = useState('');
  const [taxes, setTaxes] = useState<Line[]>([{ label: '', amount: '' }]); const [deds, setDeds] = useState<Line[]>([]); const [deps, setDeps] = useState<Line[]>([]);
  const [saved, setSaved] = useState('');
  const [periodFrom, setPeriodFrom] = useState(''); const [periodTo, setPeriodTo] = useState('');
  // reading a pay slip: picked, redacted on this device (web), read, then put in the form below for the person to check
  const redact = useRedactSettings();
  const [slip, setSlip] = useState<{ file: PickedFile; stage: 'scanning' | 'redact' | 'reading' | 'failed'; message?: string; scan?: Scan; boxes: RedactBox[]; busy?: boolean; error?: string } | null>(null);
  const [readInfo, setReadInfo] = useState<{ notes: string[]; readBy?: string; fileName: string } | null>(null);

  const draft: PayRecord = {
    id: 'draft', sourceId: srcId || (income.sources.length === 1 ? income.sources[0].id : ''), date, grossCents: cents(gross) || 0, netCents: cents(net) || 0,
    taxes: taxes.filter((l) => l.label.trim() || l.amount.trim()).map((l) => ({ label: l.label.trim(), cents: cents(l.amount) || 0 })),
    deductions: deds.filter((l) => l.label.trim() || l.amount.trim()).map((l) => ({ label: l.label.trim(), cents: cents(l.amount) || 0, group: l.group ?? 'other' })),
    deposits: deps.filter((l) => l.amount.trim()).map((l) => ({ ...(l.last4 ? { last4: l.last4 } : {}), cents: cents(l.amount) || 0 })),
    ...(periodFrom ? { periodFrom } : {}), ...(periodTo ? { periodTo } : {}),
    ...(readInfo ? { note: provenance(readInfo.readBy, readInfo.fileName) } : {}),
  };
  const issues = open ? recordIssues(draft) : [];
  const ready = !!draft.sourceId && !issues.length;
  const needsSource = open && !draft.sourceId;
  const sourceName = (id: string) => income.sources.find((s) => s.id === id)?.name ?? 'Removed source';
  const txnById = useMemo(() => new Map(txns.map((t) => [t.id, t])), [txns]);

  const submitRecord = () => {
    const rec = { ...draft, id: newIncomeId('p', income.records) };
    const r = saveRecord(income, rec);
    if (r.issues.length) return setNotice(r.issues.join(' '));
    saveIncome(r.state); setNotice(''); setSaved(`Saved the ${dayLabel(rec.date)} pay record.`);
    setOpen(false); clearForm();
  };

  const fill = (d: PayslipDraft, fileName: string) => {
    setSrcId(d.sourceId ?? ''); setDate(d.date); setGross(d.gross); setNet(d.net); setPeriodFrom(d.periodFrom); setPeriodTo(d.periodTo);
    setTaxes(d.taxes.length ? d.taxes : [{ label: '', amount: '' }]); setDeds(d.deductions); setDeps(d.deposits);
    setReadInfo({ notes: d.notes, readBy: d.readBy, fileName }); setOpen(true); setSaved(''); setNotice('');
  };
  const readIt = async (file: PickedFile) => {
    setSlip({ file, stage: 'reading', boxes: [], message: 'Reading the pay slip' });
    try {
      fill(draftFromRead(await readPayslipFile(file), income.sources), file.name);
      setSlip(null);
    } catch (e) { setSlip({ file, stage: 'failed', boxes: [], error: (e as Error).message }); }
  };
  const pickSlip = async (source: 'files' | 'photos') => {
    setNotice('');
    let files: PickedFile[] = [];
    try { files = await pickFiles(source); } catch (e) { return setNotice((e as Error).message); }
    const file = files[0];
    if (!file) return;
    if (!redactionSupported || !redact.onRef.current) return readIt(file);
    setSlip({ file, stage: 'scanning', boxes: [], message: 'Preparing' });
    try {
      const scan = await scanForRedaction(file.bytes, file.type, parseHideWords(redact.wordsRef.current), (m) => setSlip((x) => (x && x.stage === 'scanning' ? { ...x, message: `${m}. This happens on your device; nothing is sent anywhere.` } : x)));
      setSlip({ file, stage: 'redact', scan, boxes: scan.boxes });
    } catch (e) { setSlip({ file, stage: 'failed', boxes: [], error: `Could not scan the file for sensitive details (${(e as Error).message}). Read it without redacting, or discard it.` }); }
  };
  const dropSlip = () => { if (slip?.scan) discardScan(slip.scan); setSlip(null); };
  const approveSlip = async () => {
    if (!slip?.scan) return;
    const { file, scan, boxes } = slip;
    setSlip({ ...slip, busy: true, error: undefined });
    try {
      const out = await burnRedactions(scan, boxes, file.type === 'application/pdf');
      discardScan(scan);
      await readIt({ ...file, bytes: out.bytes, type: out.type });
    } catch (e) { setSlip((x) => (x ? { ...x, busy: false, error: (e as Error).message } : x)); }
  };
  const skipRedaction = async () => { if (!slip) return; const file = slip.file; if (slip.scan) discardScan(slip.scan); await readIt(file); };
  const clearForm = () => { setDate(''); setGross(''); setNet(''); setTaxes([{ label: '', amount: '' }]); setDeds([]); setDeps([]); setPeriodFrom(''); setPeriodTo(''); setReadInfo(null); };

  return (
    <Screen max={820}>
      <ScreenHeader back title="Income" sub={`Where money comes from, and what was taken out of it. ${range.label}.`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {months.slice(-12).map((m) => <Chip key={m} label={monthLabel(m, true)} on={period === m} onPress={() => setPeriod(m)} />)}
        <Chip label="All" on={period === 'all'} onPress={() => setPeriod('all')} />
      </View>

      <Card title="Income in this period">
        <T size={32} bold>{dollars(sum.totalCents)}</T>
        <T size={12} tone="ink3">What reached your accounts, from your statements. Pay before deductions (gross) is only known where you added a pay record.</T>
        {!sum.sources.length ? <T size={13} tone="ink2">No income deposits in this period.</T> : null}
        {sum.sources.map((s) => {
          const share = sum.totalCents > 0 ? Math.max(0, Math.min(1, s.depositsCents / sum.totalCents)) : 0;
          return (
            <View key={s.source?.id ?? 'none'} style={{ gap: 2, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
                <T size={15} bold style={{ flex: 1 }}>{s.source ? s.source.name : 'Not assigned to a source'}</T><T size={15} bold>{dollars(s.depositsCents)}</T>
              </View>
              <View style={{ height: 6, backgroundColor: C.line, borderRadius: 3, overflow: 'hidden' }}><View style={{ width: `${Math.max(share * 100, s.depositsCents > 0 ? 2 : 0)}%`, height: '100%', backgroundColor: s.source ? C.bar : C.bad, borderRadius: 3 }} /></View>
              <T size={12} tone="ink3">
                {s.source ? `${INCOME_TYPE_LABEL[s.source.type]} · ` : ''}{s.count} deposit{s.count === 1 ? '' : 's'}
                {s.source && s.depositsCents > 0 ? ` · ${Math.round((s.provenCents / s.depositsCents) * 100)}% matched to a pay record` : ''}
              </T>
              {s.records ? <T size={13} tone="ink2">From {s.records} pay record{s.records === 1 ? '' : 's'}: gross {dollars(s.grossCents)}, taxes {dollars(s.taxCents)}{s.taxRate != null ? ` (${(s.taxRate * 100).toFixed(1)}% of gross)` : ''}, deductions {dollars(s.deductionCents)}, net {dollars(s.netCents)}.</T> : null}
            </View>
          );
        })}
      </Card>

      <Card title="Taxes" right={<T size={12} tone="ink3">Three views, never added together</T>}>
        <T size={13} bold>Taken from pay</T>
        <T size={22} bold>{dollars(sum.withheldCents)}</T>
        {sum.withheld.map((w) => <View key={w.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={13} tone="ink2">{w.label}</T><T size={13}>{dollars(w.cents, { decimals: true })}</T></View>)}
        <T size={12} tone="ink3">{sum.withheld.length ? 'From the pay records you added, so it covers only the paychecks you recorded.' : 'Add pay records below to see taxes taken from your pay.'}</T>
        {sum.insuranceCents || sum.retirementCents ? <T size={13} tone="ink2">Also taken from pay: insurance {dollars(sum.insuranceCents)}, retirement {dollars(sum.retirementCents)}. These never appear as spending on a statement.</T> : null}

        <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          <T size={13} bold>Paid from a bank account</T>
          <T size={22} bold>{dollars(sum.paid.cents)}</T>
          {sum.paid.txns.slice(0, 6).map((t) => <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}><T size={13} tone="ink2" style={{ flex: 1 }}>{dayLabel(t.date)}  {t.merchant}</T><T size={13}>{dollars(-t.cents, { decimals: true })}</T></View>)}
          {sum.paid.txns.length > 6 ? <T size={12} tone="ink3">and {sum.paid.txns.length - 6} more</T> : null}
          <T size={12} tone="ink3">Statement lines whose description names the IRS, a revenue department or a tax payment. Judged from the text, so check the list.</T>
        </View>

        <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          <T size={13} bold>Sales tax on receipts</T>
          <T size={22} bold>{dollars(sum.salesTaxCents)}</T>
          <T size={12} tone="ink3">From {sum.salesTaxReceipts} receipt{sum.salesTaxReceipts === 1 ? '' : 's'} you imported. Receipts you did not import are missing, so this is a minimum.</T>
        </View>
      </Card>

      {sum.unassigned.length ? (
        <Card title={`Deposits to assign (${sum.unassigned.length})`}>
          {!income.sources.length ? <T size={13} tone="ink2">Add an income source below first, then say which deposits belong to it.</T> : <T size={12} tone="ink3">Say where each deposit came from. A pay record that names a deposit assigns it for you.</T>}
          {sum.unassigned.slice(0, 8).map((t) => (
            <View key={t.id} style={{ gap: 4, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}><T size={14} style={{ flex: 1 }}>{dayLabel(t.date)}  {t.merchant}</T><T size={14} bold>{dollars(t.cents, { decimals: true })}</T></View>
              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                {income.sources.map((s) => <Chip key={s.id} label={s.name} onPress={() => saveIncome(assignDeposit(income, t.id, s.id))} />)}
                <Button small kind="ghost" label="See it" onPress={() => router.push({ pathname: '/txn/[id]', params: { id: t.id } })} />
              </View>
            </View>
          ))}
          {sum.unassigned.length > 8 ? <T size={12} tone="ink3">{sum.unassigned.length - 8} more after these are assigned.</T> : null}
        </Card>
      ) : null}

      <Card title="Income sources">
        {!income.sources.length ? <T size={13} tone="ink2">None yet. A source is a job, a business, dividends or rent: anything money arrives from.</T> : null}
        {income.sources.map((s) => (
          <View key={s.id} style={{ gap: 2, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
            <T size={15} bold>{s.name}</T>
            <T size={12} tone="ink3">{INCOME_TYPE_LABEL[s.type]}{s.words.length ? ` · deposits mentioning: ${s.words.join(', ')}` : ' · no matching words, deposits are assigned by hand or by pay records'}</T>
            <View style={{ flexDirection: 'row' }}>
              <Button small kind="ghost" label="Remove" onPress={() => { const next = removeSource(income, s.id); if (next) { saveIncome(next); setNotice(''); } else setNotice(`${s.name} still has pay records. Remove those first.`); }} />
            </View>
          </View>
        ))}
        <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          <T size={13} bold>Add a source</T>
          <TextInput value={srcName} onChangeText={setSrcName} placeholder="Name, for example Acme Corp or Consulting" placeholderTextColor={C.ink3} accessibilityLabel="Income source name" style={input} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{INCOME_TYPES.map((t) => <Chip key={t} label={INCOME_TYPE_LABEL[t]} on={srcType === t} onPress={() => setSrcType(t)} />)}</View>
          <TextInput value={srcWords} onChangeText={setSrcWords} placeholder="Words in its deposits, separated by commas (optional)" placeholderTextColor={C.ink3} accessibilityLabel="Words that mark its deposits" style={input} />
          <View style={{ flexDirection: 'row' }}>
            <Button label="Add source" disabled={!srcName.trim()} onPress={() => { saveIncome(saveSource(income, { id: newIncomeId('i', income.sources), name: srcName, type: srcType, words: parseWords(srcWords) })); setSrcName(''); setSrcWords(''); setNotice(''); }} />
          </View>
        </View>
      </Card>

      <Card title="Pay records" right={<Button small kind={open ? 'ghost' : 'outline'} label={open ? 'Cancel' : 'Type one by hand'} disabled={!income.sources.length} onPress={() => { setOpen(!open); setSaved(''); if (open) clearForm(); }} />}>
        {!income.sources.length ? <T size={13} tone="ink2">Add an income source first.</T> : null}
        <T size={12} tone="ink3">One per paycheck or payout, copied from the pay slip. It is saved only when gross minus taxes and deductions equals net pay, and each deposit it names is looked for on your statements.</T>
        {saved ? <T size={13} tone="good">{saved}</T> : null}

        {!slip ? (
          <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
            <T size={13} bold>Read a pay slip</T>
            <T size={12} tone="ink3">Choose a pay slip PDF, a photo or a screenshot of your payroll page. It is read into the form below so you can check every figure against the slip before saving. The file itself is not kept, only the figures you save.</T>
            {redactionSupported ? (
              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip label="Redact pay slips first" on={redact.on} onPress={() => redact.save(!redact.on, redact.words)} />
                <T size={12} tone="ink3">{redact.on ? 'On: names, addresses and account numbers are blacked out on your device first, and you check the boxes before anything is read.' : 'Off: the slip is read exactly as it is'}</T>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
              <Button small label="Choose a file" disabled={!income.sources.length} onPress={() => pickSlip('files')} />
              <Button small kind="outline" label="Choose a photo" disabled={!income.sources.length} onPress={() => pickSlip('photos')} />
            </View>
          </View>
        ) : slip.stage === 'redact' && slip.scan ? (
          <View style={{ gap: S.sm }}>
            <T size={13} bold>{slip.file.name}</T>
            <RedactReview scan={slip.scan} boxes={slip.boxes} hideText={redact.words} busy={!!slip.busy} error={slip.error} noun="pay slip" kept={false}
              onBoxes={(b) => setSlip((x) => (x ? { ...x, boxes: b, error: undefined } : x))}
              onSearch={(w, t) => { redact.save(redact.on, t); setSlip((x) => (x?.scan ? { ...x, boxes: withNewSearch(x.boxes, findSensitive(x.scan.words, { hide: w })) } : x)); }}
              onApprove={approveSlip} onSkip={skipRedaction} onDiscard={dropSlip} />
          </View>
        ) : slip.stage === 'failed' ? (
          <View style={{ gap: S.sm, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
            <T size={13} tone="bad">{slip.error}</T>
            <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
              <Button small kind="outline" label="Read it without redacting" onPress={skipRedaction} />
              <Button small kind="ghost" label="Discard" onPress={dropSlip} />
            </View>
          </View>
        ) : <T size={13} tone="ink2">{slip.message ?? 'Working'}</T>}

        {open ? (
          <View style={{ gap: S.sm, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
            {readInfo ? (
              <View style={{ gap: 2 }}>
                <T size={13} bold>Read from {readInfo.fileName}{readInfo.readBy ? ` by ${readInfo.readBy}` : ''}. Check every figure against your slip before saving.</T>
                {readInfo.notes.map((n) => <T key={n} size={13} tone="ink2">{n}</T>)}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{income.sources.map((s) => <Chip key={s.id} label={s.name} on={draft.sourceId === s.id} onPress={() => setSrcId(s.id)} />)}</View>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <Field value={date} onChange={setDate} placeholder="Pay date YYYY-MM-DD" label="Pay date" />
              <Field value={gross} onChange={setGross} placeholder="Gross pay" label="Gross pay" />
              <Field value={net} onChange={setNet} placeholder="Net pay (take home)" label="Net pay" />
            </View>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <Field value={periodFrom} onChange={setPeriodFrom} placeholder="Period from YYYY-MM-DD (optional)" label="Pay period start" />
              <Field value={periodTo} onChange={setPeriodTo} placeholder="Period to YYYY-MM-DD (optional)" label="Pay period end" />
            </View>
            <Lines title="Taxes taken out" kind="tax" lines={taxes} onChange={setTaxes} />
            <Lines title="Other deductions (insurance, retirement, other)" kind="deduction" lines={deds} onChange={setDeds} />
            <Lines title="Where it was deposited (optional, lets the app find it on your statements)" kind="deposit" lines={deps} onChange={setDeps} />
            {issues.length && (gross || net) ? issues.map((i) => <T key={i} size={13} tone="bad">{i}</T>) : null}
            {needsSource ? <T size={13} tone="bad">Choose which income source this pay record belongs to.</T> : null}
            {!issues.length && draft.sourceId ? <T size={13} tone="good">Adds up: {dollars(draft.grossCents, { decimals: true })} minus {dollars(draft.grossCents - draft.netCents, { decimals: true })} taken out is {dollars(draft.netCents, { decimals: true })}.</T> : null}
            <View style={{ flexDirection: 'row' }}><Button label="Save pay record" disabled={!ready} onPress={submitRecord} /></View>
          </View>
        ) : null}

        {[...income.records].sort((a, b) => b.date.localeCompare(a.date)).map((r) => {
          const ms = matches.get(r.id) ?? [];
          const found = ms.filter((m) => m.txnId).length;
          return (
            <View key={r.id} style={{ gap: 2, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
                <T size={15} bold style={{ flex: 1 }}>{dayLabel(r.date)}  {sourceName(r.sourceId)}</T><T size={15} bold>{dollars(r.netCents, { decimals: true })}</T>
              </View>
              <T size={13} tone="ink2">Gross {dollars(r.grossCents, { decimals: true })}, taxes {dollars(r.taxes.reduce((s, l) => s + l.cents, 0), { decimals: true })}, deductions {dollars(r.deductions.reduce((s, l) => s + l.cents, 0), { decimals: true })}.</T>
              {ms.length ? (
                <T size={12} tone={found === ms.length ? 'good' : 'bad'}>
                  {found === ms.length ? `All ${found} deposit${found === 1 ? '' : 's'} found on your statements.` : `${found} of ${ms.length} deposits found on your statements. Missing: ${ms.filter((m) => !m.txnId).map((m) => `${dollars(m.line.cents, { decimals: true })}${m.line.last4 ? ` to ${m.line.last4}` : ''}`).join(', ')}. The statement may not be imported yet, or the amount differs.`}
                </T>
              ) : <T size={12} tone="ink3">No deposits listed, so nothing to check on the statements.</T>}
              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                {ms.filter((m) => m.txnId && txnById.get(m.txnId)).slice(0, 1).map((m) => <Button key={m.txnId} small kind="ghost" label="See a deposit" onPress={() => router.push({ pathname: '/txn/[id]', params: { id: m.txnId! } })} />)}
                <Button small kind="ghost" label="Remove" onPress={() => saveIncome(removeRecord(income, r.id))} />
              </View>
            </View>
          );
        })}
      </Card>
      {notice ? <Banner title="Not done">{notice}</Banner> : null}
      <View style={{ height: S.md }} />
    </Screen>
  );
}
