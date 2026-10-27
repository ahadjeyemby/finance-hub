import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { FieldInput } from '@/components/intake';
import { ScreenHeader } from '@/components/header';
import { addCategory, editCategory, everyCategory, mergeCategory, removeCustomCategory, resolveCategory, unmergeCategory } from '@/core/categories';
import type { Category } from '@/core/types';
import { dollars } from '@/core/queries';
import { deleteTag, saveTag, tagTotals } from '@/core/tags';
import { useRepo } from '@/data/repo';
import { F, R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Card, Chip, Screen, T } from '@/theme/ui';

const GROUPS: { id: Category['group']; label: string }[] = [{ id: 'need', label: 'Need' }, { id: 'want', label: 'Want' }, { id: 'mixed', label: 'Mixed' }];
const SPEND = new Set(['spend', 'fee', 'refund']);
const words = (text: string) => text.split(/[,\n;]+/).map((w) => w.trim()).filter(Boolean);

export default function Categories() {
  const C = useColors();
  const { txns, categoryConfig, saveCategoryConfig, tagState, saveTagState } = useRepo();
  const [newCat, setNewCat] = useState(''); const [newGroup, setNewGroup] = useState<Category['group']>('need');
  const [newTag, setNewTag] = useState(''); const [newWords, setNewWords] = useState('');
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [error, setError] = useState('');

  // spending by category, as the app counts it now (a merged category counts as the one it was folded into)
  const byCat = useMemo(() => {
    const m = new Map<string, { cents: number; count: number }>();
    for (const t of txns) if (SPEND.has(t.kind)) { const k = t.category ?? 'uncategorized'; const e = m.get(k) ?? { cents: 0, count: 0 }; e.cents += -t.cents; e.count++; m.set(k, e); }
    return m;
  }, [txns]);
  const tagSums = useMemo(() => new Map(tagTotals(txns.filter((t) => SPEND.has(t.kind)), tagState.defs).map((x) => [x.tag, x])), [txns, tagState.defs]);
  const cats = everyCategory();
  const active = cats.filter((c) => !categoryConfig?.edits[c.id]?.hidden && !categoryConfig?.merged[c.id]);

  return (
    <Screen max={820}>
      <ScreenHeader back title="Categories and tags" sub="Each charge and item has one category. Tags overlap, for views like Health, Household and Work." />
      {error ? <Banner title="That did not work">{error}</Banner> : null}

      <Card title="Categories">
        <T size={12} tone="ink3">Rename a category, move it between Need, Want and Mixed, hide it from the pickers, or fold it into another (its charges then count as the other one; nothing on the charges is changed, and you can undo it). Hiding or merging never deletes a charge.</T>
        {cats.map((c) => {
          const hidden = !!categoryConfig?.edits[c.id]?.hidden; const into = categoryConfig?.merged[c.id];
          const sum = byCat.get(c.id); const custom = c.id.startsWith('c_');
          return (
            <View key={c.id} style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md, opacity: hidden || into ? 0.75 : 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
                <T size={13} bold>{c.label}{into ? `, merged into ${cats.find((x) => x.id === resolveCategory(c.id))?.label ?? into}` : hidden ? ' (hidden)' : ''}</T>
                <T size={12} tone="ink3">{sum ? `${dollars(sum.cents)}, ${sum.count} charges` : 'no charges'}</T>
              </View>
              {c.id !== 'uncategorized' ? (
                <>
                  <FieldInput key={`${c.id}:${c.label}`} label="Name" value={c.label} onCommit={(t) => saveCategoryConfig(editCategory(categoryConfig, c.id, { label: t }))} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    {GROUPS.map((g) => <Chip key={g.id} label={g.label} on={c.group === g.id} onPress={() => saveCategoryConfig(editCategory(categoryConfig, c.id, { group: g.id }))} />)}
                  </View>
                  <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                    <Button small kind="ghost" label={hidden ? 'Show in pickers' : 'Hide from pickers'} onPress={() => saveCategoryConfig(editCategory(categoryConfig, c.id, { hidden: !hidden }))} />
                    {into ? <Button small kind="outline" label="Undo the merge" onPress={() => saveCategoryConfig(unmergeCategory(categoryConfig, c.id))} />
                      : <Button small kind="outline" label={mergeFrom === c.id ? 'Cancel merge' : 'Merge into another'} onPress={() => setMergeFrom(mergeFrom === c.id ? null : c.id)} />}
                    {custom ? <Button small kind="ghost" label={sure === c.id ? 'Press again to delete' : 'Delete'} disabled={!!sum?.count} onPress={() => { if (sure === c.id) { saveCategoryConfig(removeCustomCategory(categoryConfig, c.id)); setSure(null); } else setSure(c.id); }} /> : null}
                  </View>
                  {custom && sum?.count ? <T size={12} tone="ink3">It has charges, so it cannot be deleted. Merge it into another category instead.</T> : null}
                  {mergeFrom === c.id ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      <T size={12} tone="ink3">Fold {c.label} into:</T>
                      {active.filter((x) => x.id !== c.id && x.id !== 'uncategorized').map((x) => <Chip key={x.id} label={x.label} onPress={() => { const next = mergeCategory(categoryConfig, c.id, x.id); if (!next) setError('That merge would loop back on itself.'); else { setError(''); saveCategoryConfig(next); setMergeFrom(null); } }} />)}
                    </View>
                  ) : null}
                </>
              ) : <T size={12} tone="ink3">Where charges wait until they have a category.</T>}
            </View>
          );
        })}
        <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          <T size={13} bold>Add a category</T>
          <TextInput value={newCat} onChangeText={setNewCat} placeholder="Name, for example Pet care" placeholderTextColor={C.ink3} accessibilityLabel="New category name"
            style={{ minHeight: 44, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {GROUPS.map((g) => <Chip key={g.id} label={g.label} on={newGroup === g.id} onPress={() => setNewGroup(g.id)} />)}
            <Button small label="Add category" disabled={!newCat.trim()} onPress={() => { saveCategoryConfig(addCategory(categoryConfig, newCat, newGroup).config); setNewCat(''); }} />
          </View>
        </View>
      </Card>

      <Card title="Tags">
        <T size={12} tone="ink3">A tag is found automatically from the words in a merchant, a bank description or an item, from a category, and from the Business switch. List the words that should give each tag, separated by commas. You can always add or take a tag off a single charge or item from its page.</T>
        {tagState.defs.map((d) => {
          const sum = tagSums.get(d.id);
          return (
            <View key={d.id} style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
                <T size={13} bold>{d.label}</T>
                <T size={12} tone="ink3">{sum?.count ? `${dollars(sum.cents)}, ${sum.count} charges` : 'no charges yet'}</T>
              </View>
              <FieldInput key={`n:${d.id}:${d.label}`} label="Name" value={d.label} onCommit={(t) => saveTagState(saveTag(tagState, { id: d.id, label: t || d.label }))} />
              <FieldInput key={`k:${d.id}:${d.keywords.join(',')}`} label="Words that give this tag (commas)" multiline value={d.keywords.join(', ')} onCommit={(t) => saveTagState(saveTag(tagState, { id: d.id, label: d.label, keywords: words(t) }))} />
              <T size={12} tone="ink3">{[d.categories?.length ? `Also given to charges and items in: ${d.categories.map((id) => cats.find((c) => c.id === id)?.label ?? id).join(', ')}.` : '', d.business ? 'Also given to charges marked Business.' : ''].filter(Boolean).join(' ') || 'Only the words above give it.'}</T>
              <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                <Chip label={d.auto ? 'Found automatically' : 'Only added by hand'} on={d.auto} onPress={() => saveTagState(saveTag(tagState, { id: d.id, label: d.label, auto: !d.auto }))} />
                <Button small kind="outline" label="See the charges" onPress={() => router.push({ pathname: '/ledger', params: { tags: d.id } })} />
                <Button small kind="ghost" label={sure === `t:${d.id}` ? 'Press again to delete' : 'Delete tag'} onPress={() => { if (sure === `t:${d.id}`) { saveTagState(deleteTag(tagState, d.id)); setSure(null); } else setSure(`t:${d.id}`); }} />
              </View>
            </View>
          );
        })}
        <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          <T size={13} bold>Add a tag</T>
          <TextInput value={newTag} onChangeText={setNewTag} placeholder="Name, for example Pets" placeholderTextColor={C.ink3} accessibilityLabel="New tag name"
            style={{ minHeight: 44, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink }} />
          <TextInput value={newWords} onChangeText={setNewWords} placeholder="Words that give it, for example petco, vet, dog food" placeholderTextColor={C.ink3} accessibilityLabel="Words for the new tag"
            style={{ minHeight: 44, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink }} />
          <View style={{ flexDirection: 'row' }}><Button small label="Add tag" disabled={!newTag.trim()} onPress={() => { saveTagState(saveTag(tagState, { label: newTag, keywords: words(newWords), auto: true })); setNewTag(''); setNewWords(''); }} /></View>
        </View>
      </Card>
    </Screen>
  );
}
