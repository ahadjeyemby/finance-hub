import { useState } from 'react';
import { TextInput, View } from 'react-native';

import type { Analysis, Gap, StatementDraft } from '@/core/intake';
import { addRow, flipRow, removeRow } from '@/core/intake';
import { dollars } from '@/core/queries';
import { C, F, R, S } from '@/theme/tokens';
import { Banner, Button, Chip, T } from '@/theme/ui';

export const input = { minHeight: 44, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink } as const;

/** One text box that applies its value when the person leaves it. Remounts (via key) when the stored value changes. */
export function FieldInput({ label, value, onCommit, multiline, error }: { label: string; value: string; onCommit: (text: string) => void; multiline?: boolean; error?: string }) {
  const [text, setText] = useState(value);
  return (
    <View style={{ gap: 2 }}>
      <T size={12} tone="ink3">{label}</T>
      <TextInput
        style={[input, multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: S.md }]} value={text} multiline={multiline} accessibilityLabel={label}
        onChangeText={setText} onBlur={() => { if (text !== value) onCommit(text); }} onSubmitEditing={() => { if (!multiline && text !== value) onCommit(text); }}
        placeholderTextColor={C.ink3} />
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
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
          <TextInput
            style={[input, { flex: 1, backgroundColor: C.paper }, gap.input === 'items' && { minHeight: 96, textAlignVertical: 'top', paddingTop: S.md }]}
            value={text} onChangeText={setText} multiline={gap.input === 'items'} accessibilityLabel={gap.label} placeholderTextColor={C.ink3}
            keyboardType={gap.input === 'money' ? 'numbers-and-punctuation' : gap.input === 'last4' ? 'number-pad' : 'default'} maxLength={gap.input === 'last4' ? 4 : undefined}
            placeholder={gap.input === 'date' ? 'YYYY-MM-DD' : gap.input === 'money' ? '0.00' : gap.input === 'items' ? 'milk 4.50\nrice 12.00' : ''}
            onSubmitEditing={() => { if (gap.input !== 'items' && text.trim()) onAnswer(text); }} />
          <Button small label="Save" disabled={!text.trim()} onPress={() => onAnswer(text)} />
        </View>
      )}
      {error ? <T size={12} tone="bad">{error}</T> : null}
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
