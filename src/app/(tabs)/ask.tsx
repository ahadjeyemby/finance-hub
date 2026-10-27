import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { AskBox } from '@/components/askbox';
import { ReportView } from '@/components/reportview';
import { ScreenHeader } from '@/components/header';
import { askAgent } from '@/core/agent';
import type { AgentResult } from '@/core/agent';
import { todayISO } from '@/core/dates';
import { makePost } from '@/data/agentClient';
import { useRepo } from '@/data/repo';
import { withScope } from '@/lib/reportScope';
import { R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Screen, T } from '@/theme/ui';

const SUGGEST = ['How much did I spend on fuel in August?', 'What did I earn in July?', 'Biggest purchases this summer', 'What will I spend next month?'];
const SPENDING_SUGGEST = ['How much was spent on fuel in August?', 'Biggest purchases this summer', 'Groceries by store', 'What will next month cost?'];

export default function Ask() {
  const C = useColors();
  const { ctx, scope, dataTo, dataFrom, colorOf, completeTo, spendingOnly } = useRepo();
  const [log, setLog] = useState<{ id: number; q: string; a?: AgentResult; open?: boolean }[]>([]);
  const [pending, setPending] = useState(0);
  const busy = pending > 0;
  const nextId = useRef(0);
  // each question keeps its own entry, so a second one sent before the first is answered never takes the first one's reply
  const send = async (q: string) => {
    const id = ++nextId.current;
    setPending((n) => n + 1);
    setLog((l) => [...l, { id, q }]);
    try {
      const a = await askAgent(q, ctx, { today: todayISO(), dataFrom, dataTo, scope, spendingOnly }, makePost());
      setLog((l) => l.map((x) => (x.id === id ? { ...x, a } : x)));
    } finally { setPending((n) => n - 1); }
  };
  // a question typed in the Ask field of the top bar arrives as ?q=; it is sent once
  const { q: asked } = useLocalSearchParams<{ q?: string }>();
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!asked || sent.current === asked) return;
    sent.current = asked;
    send(asked);
  });
  return (
    <Screen max={760}>
      <ScreenHeader back title="Ask" sub={makePost() ? 'Answered by the assistant, using your ledger.' : 'Answered by the built-in planner. Connect the assistant for open-ended questions.'} />
      {log.map((m, i) => (
        <View key={m.id} style={{ gap: S.sm }}>
          <View style={{ alignSelf: 'flex-end', backgroundColor: C.accent, borderRadius: R.md, padding: S.md, maxWidth: '85%' }}><T style={{ color: C.onAccent }}>{m.q}</T></View>
          {m.a ? (
            <View style={{ gap: S.sm }}>
              <View style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md, gap: S.sm }}>
                <T>{m.a.text}</T>
                {m.a.report ? <Button small kind="outline" label={m.open ? 'Hide report' : 'Show report'} onPress={() => setLog((l) => l.map((x, j) => (j === i ? { ...x, open: !x.open } : x)))} style={{ alignSelf: 'flex-start' }} /> : null}
              </View>
              {m.a.note ? <Banner tone="info" title={m.a.note} /> : null}
              {m.open && m.a.report ? <ReportView spec={withScope(m.a.report, scope)} ctx={ctx} colorOf={colorOf} dataTo={dataTo} completeTo={completeTo} /> : null}
            </View>
          ) : <T size={13} tone="ink3">Working...</T>}
        </View>
      ))}
      <AskBox placeholder="Ask about your money" cta="Ask" suggestions={log.length ? [] : spendingOnly ? SPENDING_SUGGEST : SUGGEST} busy={busy} onSubmit={send} />
    </Screen>
  );
}
