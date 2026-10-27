import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { TxnRow } from '@/components/txnrow';
import { ScreenHeader } from '@/components/header';
import { allCategories, categoryLabel } from '@/core/categories';
import { dollars, listTxns } from '@/core/queries';
import type { Filter } from '@/core/queries';
import type { CategoryId, Kind } from '@/core/types';
import { useRepo } from '@/data/repo';
import { F, R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Card, T } from '@/theme/ui';
import type { LedgerParams } from './txpanelctx';

/** The transactions that match a filter. On its page it carries its own header; in the side panel the panel supplies the frame. */
export function LedgerBody({ params: p, embedded = false }: { params: LedgerParams; embedded?: boolean }) {
  const C = useColors();
  const { ctx, scope, tagState, spendingOnly } = useRepo();
  const [text, setText] = useState('');
  const filter = useMemo<Filter>(() => ({
    scope, text: text || undefined, from: p.from, to: p.to,
    categories: p.category ? [p.category as CategoryId] : p.group ? allCategories().filter((c) => c.group === p.group).map((c) => c.id) : undefined,
    tags: p.tags ? p.tags.split(',') : undefined,
    merchants: p.merchant ? [p.merchant] : undefined,
    kinds: p.kinds ? (p.kinds.split(',') as Kind[]) : undefined,
  }), [scope, text, p.from, p.to, p.category, p.merchant, p.kinds, p.tags, p.group]);
  const rows = useMemo(() => listTxns(ctx, filter, 400), [ctx, filter]);
  const incoming = !spendingOnly && (p.kinds === 'income' || p.kinds === 'rewards');
  const total = rows.reduce((s, t) => s - t.cents, 0);
  const label = [spendingOnly ? '' : p.kinds === 'income' ? 'Earned' : p.kinds === 'rewards' ? 'Rewards' : '', p.tags ? `Tag: ${p.tags.split(',').map((id) => tagState.defs.find((d) => d.id === id)?.label ?? id).join(', ')}` : '', p.group ? `${p.group === 'want' ? 'Wants' : p.group === 'need' ? 'Needs' : 'Mixed'}` : '', p.category && categoryLabel(p.category), p.merchant, p.from && p.to ? `${p.from} to ${p.to}` : ''].filter(Boolean).join(', ');
  return (
    <>
      <ScreenHeader back={!embedded} title="Transactions" sub={label || 'Everything in the ledger'} />
      <TextInput value={text} onChangeText={setText} placeholder="Search merchant or description" placeholderTextColor={C.ink3} accessibilityLabel="Search transactions"
        style={{ minHeight: 44, borderRadius: R.md, backgroundColor: C.paper, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 14, color: C.ink }} />
      <T size={12} tone="ink3">{rows.length} shown{rows.length === 400 ? ' (first 400)' : ''}. {incoming ? `Total of these rows: ${dollars(-total)}. Open one to see its statement line.` : spendingOnly ? `Spending in these rows: ${dollars(total)}` : `Net outflow of these rows: ${dollars(total)}`}</T>
      <Card><View>{rows.map((t) => <TxnRow key={t.id} t={t} />)}{rows.length === 0 ? <T tone="ink2">Nothing matches. Clear the search or pick a wider period.</T> : null}</View></Card>
    </>
  );
}
