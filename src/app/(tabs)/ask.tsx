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

export default function Ask() {
  const C = useColors();
  const { ctx, scope, dataTo, dataFrom, colorOf, completeTo } = useRepo();
  const [log, setLog] = useState<{ q: string; a?: AgentResult; open?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const send = async (q: string) => {
    setBusy(true);
    setLog((l) => [...l, { q }]);
    const a = await askAgent(q, ctx, { today: todayISO(), dataFrom, dataTo, scope }, makePost());
    setLog((l) => l.map((x, i) => (i === l.length - 1 ? { q, a } : x)));
    setBusy(false);
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
        <View key={i} style={{ gap: S.sm }}>
          <View style={{ alignSelf: 'flex-end', backgroundColor: C.accent, borderRadius: R.md, padding: S.md, maxWidth: '85%' }}><T tone="paper">{m.q}</T></View>
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
      <AskBox placeholder="Ask about your money" cta="Ask" suggestions={log.length ? [] : SUGGEST} busy={busy} onSubmit={send} />
    </Screen>
  );
}
