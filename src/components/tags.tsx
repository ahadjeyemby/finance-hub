import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { allCategories, categoryLabel } from '@/core/categories';
import { lineKeys, saveTag, setItemCategory, setTag, txnKey } from '@/core/tags';
import type { TagDef, TagState } from '@/core/tags';
import { dollars } from '@/core/queries';
import type { Txn } from '@/core/types';
import { F, R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Button, Chip, T } from '@/theme/ui';

/** Every tag as a chip: on when the thing carries it. Press to add or take away; one the rules found says "auto" until it is taken away. */
export function TagPicker({ defs, on, auto, onToggle, onCreate }: { defs: TagDef[]; on: string[]; auto: string[]; onToggle: (id: string, on: boolean) => void; onCreate?: (label: string) => void }) {
  const C = useColors();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  return (
    <View style={{ gap: S.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {defs.map((d) => <Chip key={d.id} label={`${d.label}${on.includes(d.id) && auto.includes(d.id) ? ' (auto)' : ''}`} on={on.includes(d.id)} onPress={() => onToggle(d.id, !on.includes(d.id))} />)}
        {onCreate ? <Chip label={adding ? 'Cancel' : '+ New tag'} onPress={() => { setAdding((v) => !v); setText(''); }} /> : null}
      </View>
      {adding && onCreate ? (
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
          <TextInput value={text} onChangeText={setText} onSubmitEditing={() => { if (text.trim()) { onCreate(text.trim()); setAdding(false); setText(''); } }} placeholder="Name of the tag" placeholderTextColor={C.ink3} accessibilityLabel="New tag name"
            style={{ flex: 1, minHeight: 40, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 14, color: C.ink }} />
          <Button small label="Add" disabled={!text.trim()} onPress={() => { onCreate(text.trim()); setAdding(false); setText(''); }} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The tags on a charge, and its items one by one: each item shows its category and its tags and can be given another category or have tags added or
 * taken away. A tag the rules found says "auto"; a change made here is kept and wins over the rules.
 */
export function TagsEditor({ txn, tagState, onChange }: { txn: Txn; tagState: TagState; onChange: (next: TagState) => void }) {
  const C = useColors();
  const [open, setOpen] = useState<number | null>(null);
  const [pickCat, setPickCat] = useState<number | null>(null);
  const defs = tagState.defs;
  const e = tagState.edits[txnKey(txn.id)];
  const own = new Set([...(txn.autoTags ?? []), ...(e?.add ?? [])]);
  for (const r of e?.remove ?? []) own.delete(r);
  const keys = lineKeys(txn.id, txn.lines);

  const create = (key: string, auto: string[]) => (label: string) => {
    const next = saveTag(tagState, { label, keywords: [], auto: true });
    const id = next.defs[next.defs.length - 1].id;
    onChange(setTag(next, key, id, true, auto.includes(id)));
  };

  return (
    <View style={{ gap: S.sm }}>
      <T size={12} tone="ink3">Tags can overlap, so a charge can be Health and Household at once. They never change the category or the totals; they give the extra views.</T>
      <TagPicker defs={defs} on={[...own]} auto={txn.autoTags ?? []} onToggle={(id, on) => onChange(setTag(tagState, txnKey(txn.id), id, on, (txn.autoTags ?? []).includes(id)))} onCreate={create(txnKey(txn.id), txn.autoTags ?? [])} />
      {txn.lines?.length ? (
        <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          <T size={13} bold>Items</T>
          {txn.lines.map((l, i) => (
            <View key={keys[i]} style={{ gap: 2, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
                <T size={13} bold style={{ flex: 1 }}>{l.item}</T>
                <T size={13} bold>{dollars(l.cents)}</T>
              </View>
              <T size={12} tone="ink3">{categoryLabel(l.category ?? txn.category)}{(l.tags ?? []).length ? `, ${(l.tags ?? []).map((id) => defs.find((d) => d.id === id)?.label ?? id).join(', ')}` : ', no tags'}</T>
              <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                <Button small kind="ghost" label={open === i ? 'Done' : 'Edit tags'} onPress={() => { setOpen(open === i ? null : i); setPickCat(null); }} />
                <Button small kind="ghost" label={pickCat === i ? 'Done' : 'Change category'} onPress={() => { setPickCat(pickCat === i ? null : i); setOpen(null); }} />
              </View>
              {open === i ? <TagPicker defs={defs} on={l.tags ?? []} auto={l.autoTags ?? []} onToggle={(id, on) => onChange(setTag(tagState, keys[i], id, on, (l.autoTags ?? []).includes(id)))} onCreate={create(keys[i], l.autoTags ?? [])} /> : null}
              {pickCat === i ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {allCategories().filter((c) => c.id !== 'uncategorized').map((c) => <Chip key={c.id} label={c.label} on={(l.category ?? txn.category) === c.id} onPress={() => onChange(setItemCategory(tagState, keys[i], c.id))} />)}
                  {tagState.edits[keys[i]]?.category ? <Chip label="Back to the original" onPress={() => onChange(setItemCategory(tagState, keys[i], undefined))} /> : null}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
