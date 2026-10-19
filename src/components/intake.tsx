import { useState } from 'react';
import { TextInput, View } from 'react-native';

import type { Analysis, Gap, ReadingDiff, ReceiptDiff, StatementDraft } from '@/core/intake';
import type { ReceiptRecord } from '@/core/evidence';
import { addRow, flipRow, MAX_HINT, removeRow } from '@/core/intake';
import { dollars } from '@/core/queries';
import { C, F, R, S } from '@/theme/tokens';
import { Banner, Button, Chip, T } from '@/theme/ui';

export const input = { minHeight: 44, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink } as const;

/** One text box. Its value is applied when the person leaves the box, presses Enter, or presses the button that appears as soon as the text differs, so an edit is never silently waiting. Remounts (via key) when the stored value changes. */
export function FieldInput({ label, value, onCommit, multiline, error }: { label: string; value: string; onCommit: (text: string) => void; multiline?: boolean; error?: string }) {
  const [text, setText] = useState(value);
  return (
    <View style={{ gap: 2 }}>
      <T size={12} tone="ink3">{label}</T>
      <TextInput
        style={[input, multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: S.md }]} value={text} multiline={multiline} accessibilityLabel={label}
        onChangeText={setText} onBlur={() => { if (text !== value) onCommit(text); }} onSubmitEditing={() => { if (!multiline && text !== value) onCommit(text); }}
        placeholderTextColor={C.ink3} />
      {text !== value ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}><Button small label="Apply and re-check" onPress={() => onCommit(text)} /><T size={12} tone="ink3">Not applied yet.</T></View> : null}
      {error ? <T size={12} tone="bad">{error}</T> : null}
    </View>
  );
}

/** A question the document left open: type the answer, pick one, or say it is not printed. */
export function GapForm({ gap, onAnswer, onSkip, error }: { gap: Gap; onAnswer: (text: string) => void; onSkip: () => void; error?: string }) {
  const [text, setText] = useState('');
  const options = gap.options ?? [];
  return (
    <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
      <T bold size={13}>{gap.label}</T>
      <T size={13} tone="ink2">{gap.question}</T>
      {gap.input === 'choice' ? (
        options.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{options.map((o) => <Chip key={o.value} label={o.label} onPress={() => onAnswer(o.value)} />)}</View> : null
      ) : (
        <>
        {gap.suggest?.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{gap.suggest.map((o) => <Chip key={o.value} label={o.label} onPress={() => onAnswer(o.value)} />)}</View> : null}
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
          <TextInput
            style={[input, { flex: 1, backgroundColor: C.paper }, gap.input === 'items' && { minHeight: 96, textAlignVertical: 'top', paddingTop: S.md }]}
            value={text} onChangeText={setText} multiline={gap.input === 'items'} accessibilityLabel={gap.label} placeholderTextColor={C.ink3}
            keyboardType={gap.input === 'money' ? 'numbers-and-punctuation' : gap.input === 'last4' ? 'number-pad' : 'default'} maxLength={gap.input === 'last4' ? 4 : undefined}
            placeholder={gap.input === 'date' ? 'YYYY-MM-DD' : gap.input === 'money' ? 'Amount, e.g. 12.50' : gap.input === 'items' ? 'milk 4.50\nrice 12.00' : ''}
            onSubmitEditing={() => { if (gap.input !== 'items' && text.trim()) onAnswer(text); }} />
          <Button small label="Save" disabled={!text.trim()} onPress={() => onAnswer(text)} />
        </View>
        </>
      )}
      {error ? <T size={12} tone="bad">{error}</T> : null}
      {gap.id === 'tax' ? <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="No tax: save as 0.00" onPress={() => onAnswer('0')} /></View> : null}
      {gap.canSkip ? <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label={gap.id === 'rows' ? 'This statement has no transactions' : gap.id === 'lines' ? 'No items are listed on it' : 'Not printed on it'} onPress={onSkip} /></View> : null}
    </View>
  );
}

/** Everything the analysis found: open questions first, then numbers that disagree. Renders nothing when all is well. */
export function Findings({ analysis, errors, onAnswer, onSkip, onAcknowledge, maxGaps = 6 }: {
  analysis: Analysis; errors: Record<string, string>; onAnswer: (g: Gap, text: string) => void; onSkip: (g: Gap) => void; onAcknowledge: (id: string) => void; maxGaps?: number;
}) {
  const shown = analysis.gaps.slice(0, maxGaps);
  return (
    <View style={{ gap: S.sm }}>
      {analysis.gaps.length ? (
        <Banner title={`${analysis.gaps.length} detail${analysis.gaps.length > 1 ? 's' : ''} missing`}>Answer each one before saving. If something is genuinely not on the document, say so and it is recorded that way.</Banner>
      ) : null}
      {shown.map((g) => <GapForm key={g.id} gap={g} error={errors[g.id]} onAnswer={(t) => onAnswer(g, t)} onSkip={() => onSkip(g)} />)}
      {analysis.gaps.length > shown.length ? <T size={12} tone="ink3">{analysis.gaps.length - shown.length} more question{analysis.gaps.length - shown.length > 1 ? 's' : ''} appear after these.</T> : null}
      {analysis.problems.map((p) => (
        <View key={p.id} style={{ gap: S.xs }}>
          <Banner title="This does not add up">{p.text}</Banner>
          <View style={{ flexDirection: 'row' }}><Button small kind="outline" label={p.confirm ?? 'It matches the document, keep as printed'} onPress={() => onAcknowledge(p.id)} /></View>
        </View>
      ))}
      {analysis.notes.map((n) => <T key={n} size={12} tone="ink2">{n}</T>)}
    </View>
  );
}

/** Statement rows with the two fixes that cover most reading mistakes, plus a way to add a row the reader missed. */
export function RowsEditor({ draft, onChange }: { draft: StatementDraft; onChange: (d: StatementDraft) => void }) {
  const [date, setDate] = useState(''); const [desc, setDesc] = useState(''); const [amt, setAmt] = useState(''); const [err, setErr] = useState('');
  const [all, setAll] = useState(false);
  const rows = all ? draft.rows : draft.rows.slice(0, 8);
  return (
    <View style={{ gap: S.xs }}>
      {rows.map((r, i) => (
        <View key={`${i}-${r.date}-${r.description}-${r.cents}`} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <T size={12} tone="ink3" style={{ width: 72 }}>{r.date ?? 'no date'}</T>
          <View style={{ flex: 1 }}><T size={13} numberOfLines={1}>{r.description ?? 'no description'}</T></View>
          <T size={13} bold tone={Number.isInteger(r.cents) ? ((r.cents as number) < 0 ? 'ink' : 'good') : 'bad'}>{Number.isInteger(r.cents) ? dollars(r.cents as number) : '?'}</T>
          <Button small kind="ghost" label="Flip" onPress={() => onChange(flipRow(draft, i))} />
          <Button small kind="ghost" label="Remove" onPress={() => onChange(removeRow(draft, i))} />
        </View>
      ))}
      {draft.rows.length > 8 ? <Button small kind="ghost" label={all ? 'Show fewer rows' : `Show all ${draft.rows.length} rows`} onPress={() => setAll(!all)} /> : null}
      <T size={12} tone="ink3" style={{ marginTop: S.xs }}>Add a row the reader missed</T>
      <View style={{ flexDirection: 'row', gap: S.xs, flexWrap: 'wrap' }}>
        <TextInput style={[input, { width: 120 }]} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.ink3} accessibilityLabel="New row date" />
        <TextInput style={[input, { flex: 1, minWidth: 140 }]} value={desc} onChangeText={setDesc} placeholder="Description" placeholderTextColor={C.ink3} accessibilityLabel="New row description" />
        <TextInput style={[input, { width: 100 }]} value={amt} onChangeText={setAmt} placeholder="-12.50" placeholderTextColor={C.ink3} accessibilityLabel="New row amount" />
        <Button small kind="outline" label="Add row" onPress={() => { const r = addRow(draft, date, desc, amt); if (r.error) setErr(r.error); else { setErr(''); setDate(''); setDesc(''); setAmt(''); onChange(r.draft); } }} />
      </View>
      {err ? <T size={12} tone="bad">{err}</T> : null}
    </View>
  );
}

/** "Automatic" or one of the readers the backend allows: the choice for the next read. */
export function ReaderPicker({ models, value, onChange }: { models: string[]; value: string | undefined; onChange: (m: string | undefined) => void }) {
  if (models.length < 2) return null;
  const short = (m: string) => m.split('/').pop() ?? m;
  return (
    <View style={{ gap: 2 }}>
      <T size={12} tone="ink3">Read with</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        <Chip label="Automatic" on={value === undefined} onPress={() => onChange(undefined)} />
        {models.map((m) => <Chip key={m} label={short(m)} on={value === m} onPress={() => onChange(m)} />)}
      </View>
    </View>
  );
}

export interface Proposal { draft: StatementDraft; diff: ReadingDiff; hint: string }

const gapText = (g: number | null) => (g == null ? 'cannot be checked' : g === 0 ? 'adds up to the printed balance' : `is off by ${dollars(Math.abs(g))}`);

/** Say what looks wrong and have the file read again. The new reading is shown next to the old one and replaces it only when the person says so. */
export function RereadBox({ open, busy, error, proposal, used, max, models, onToggle, onSend, onUse, onKeep }: {
  open: boolean; busy: boolean; error?: string; proposal?: Proposal; used: number; max: number; models: string[];
  onToggle: () => void; onSend: (text: string, model?: string) => void; onUse: () => void; onKeep: () => void;
}) {
  const [text, setText] = useState('');
  const [model, setModel] = useState<string | undefined>(undefined);
  const left = max - used;
  return (
    <View style={{ gap: S.xs }}>
      {!open && !proposal ? <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="Tell the reader what is wrong" onPress={onToggle} /></View> : null}
      {open && !proposal ? (
        <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
          <T bold size={13}>What looks wrong?</T>
          <T size={13} tone="ink2">Write it as you would say it, for example “the year is 2026, not 2028” or “row 7 is $19.99”. The file is read again with your note. Your note points the reader at where to look; it still reports only what is printed, and nothing changes until you accept the new reading.</T>
          <TextInput style={[input, { minHeight: 80, textAlignVertical: 'top', paddingTop: S.md, backgroundColor: C.paper }]} multiline value={text} maxLength={MAX_HINT} onChangeText={setText} editable={!busy} placeholder="What should the reader look at again?" placeholderTextColor={C.ink3} accessibilityLabel="Note for the reader" />
          <ReaderPicker models={models} value={model} onChange={setModel} />
          <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button small label={busy ? 'Reading again' : 'Read again with this note'} disabled={busy || !text.trim() || left <= 0} onPress={() => onSend(text.trim(), model)} />
            <Button small kind="outline" label="Just read it again" disabled={busy || left <= 0} onPress={() => onSend('', model)} />
            <Button small kind="ghost" label="Cancel" disabled={busy} onPress={onToggle} />
            <T size={12} tone="ink3">{left > 0 ? `${left} re-read${left > 1 ? 's' : ''} left for this file` : 'No re-reads left for this file. Edit the details by hand.'}</T>
          </View>
          {error ? <T size={13} tone="bad">{error}</T> : null}
        </View>
      ) : null}
      {proposal ? (
        <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
          <T bold size={13}>{proposal.hint ? `The new reading, for your note “${proposal.hint}”` : 'The new reading'}</T>
          {proposal.diff.lines.length ? proposal.diff.lines.map((l, i) => <T key={i} size={13} tone="ink2">{l}</T>) : <T size={13} tone="ink2">It reads the same as before. Nothing changed.</T>}
          <T size={13} tone="ink2">Rows {gapText(proposal.diff.gapBefore)} now; with the new reading they {gapText(proposal.diff.gapAfter)}.</T>
          {proposal.draft.truncated ? <T size={13} tone="bad">The reader stopped before the end of this file, so the new reading is incomplete.</T> : null}
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            <Button small label="Use the new reading" disabled={!!proposal.draft.truncated || !proposal.diff.lines.length} onPress={() => { setText(''); onUse(); }} />
            <Button small kind="ghost" label="Keep what I had" onPress={() => { setText(''); onKeep(); }} />
          </View>
          <T size={12} tone="ink3">Either way the checks run again before Save unlocks. Compare with the PDF if you are unsure.</T>
        </View>
      ) : null}
    </View>
  );
}

export interface ReceiptProposal { record: ReceiptRecord; diff: ReceiptDiff; hint?: string }

/** Read a receipt again, on request. The new reading is shown next to the one on screen and replaces it only when the person says so. */
export function ReceiptAgainBox({ busy, error, proposal, used, max, models, onRetry, onUse, onKeep }: {
  busy: boolean; error?: string; proposal?: ReceiptProposal; used: number; max: number; models: string[]; onRetry: (model?: string, hint?: string) => void; onUse: () => void; onKeep: () => void;
}) {
  const left = max - used;
  const [model, setModel] = useState<string | undefined>(undefined);
  const [noting, setNoting] = useState(false);
  const [text, setText] = useState('');
  const hint = noting ? text.trim() : '';
  const checks = (n: number) => (n === 0 ? 'agrees with its printed amounts' : `disagrees with its printed amounts in ${n} place${n > 1 ? 's' : ''}`);
  return (
    <View style={{ gap: S.xs }}>
      {!proposal ? (
        <View style={{ gap: S.xs }}>
          <ReaderPicker models={models} value={model} onChange={setModel} />
          {noting ? (
            <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
              <T bold size={13}>What looks wrong?</T>
              <T size={13} tone="ink2">Write it as you would say it, for example “item 3 is $1.69, not $5.99” or “there is a service charge of 2%”. The receipt is read again with your note. The note points the reader at where to look; it still reports only what is printed, and nothing changes until you accept the new reading.</T>
              <TextInput style={[input, { minHeight: 80, textAlignVertical: 'top', paddingTop: S.md, backgroundColor: C.paper }]} multiline value={text} maxLength={MAX_HINT} onChangeText={setText} editable={!busy} placeholder="What should the reader look at again?" placeholderTextColor={C.ink3} accessibilityLabel="Note for the reader" />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button small kind="outline" label={busy ? 'Reading again' : hint ? 'Read again with this note' : model ? `Read again with ${model.split('/').pop()}` : 'Read again'} disabled={busy || left <= 0 || (noting && !text.trim() && false)} onPress={() => onRetry(model, hint || undefined)} />
            <Button small kind="ghost" label={noting ? 'Hide the note' : 'Tell the reader what is wrong'} disabled={busy} onPress={() => setNoting((v) => !v)} />
            <T size={12} tone="ink3">{left > 0 ? `${left} re-read${left > 1 ? 's' : ''} left for this file.${model ? '' : ' Automatic alternates between two ways of asking the reader.'}` : 'No re-reads left for this file.'}</T>
          </View>
        </View>
      ) : (
        <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
          <T bold size={13}>The new reading{proposal.record.readBy ? `, by ${proposal.record.readBy}` : ''}{proposal.hint ? `, for your note “${proposal.hint}”` : ''}</T>
          {proposal.diff.lines.length ? proposal.diff.lines.map((l, i) => <T key={i} size={13} tone="ink2">{l}</T>) : <T size={13} tone="ink2">It reads the same as before. Nothing changed.</T>}
          <T size={13} tone="ink2">The reading on screen {checks(proposal.diff.before)}. The new one {checks(proposal.diff.after)}.</T>
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            <Button small label="Use the new reading" disabled={!proposal.diff.lines.length} onPress={onUse} />
            <Button small kind="ghost" label="Keep what I had" onPress={onKeep} />
          </View>
          <T size={12} tone="ink3">Either way the checks run again before Save unlocks. Compare with the original if you are unsure.</T>
        </View>
      )}
      {error ? <T size={13} tone="bad">{error}</T> : null}
    </View>
  );
}
