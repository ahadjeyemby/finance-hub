import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { AskBox } from '@/components/askbox';
import { ReportView } from '@/components/reportview';
import { ScreenHeader } from '@/components/header';
import { askAgent } from '@/core/agent';
import { dayLabel, todayISO } from '@/core/dates';
import type { ReportSpec } from '@/core/report';
import { planReport } from '@/core/report';
import { makePost } from '@/data/agentClient';
import { useRepo } from '@/data/repo';
import { reportToHtml } from '@/lib/reportHtml';
import { withScope } from '@/lib/reportScope';
import { S } from '@/theme/tokens';
import { Banner, Button, Card, Row, Screen, T } from '@/theme/ui';

const SUGGEST = ['Spending report for August', 'Fuel and car maintenance since June', 'Earned vs spent by month', 'Groceries by store', 'Forecast for next month'];

export default function Reports() {
  const { ctx, scope, dataTo, dataFrom, colorOf, overlay, saveReport, deleteReport, completeTo } = useRepo();
  const [cur, setCur] = useState<{ prompt: string; spec: ReportSpec; saved?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const build = async (prompt: string) => {
    setBusy(true); setNote('');
    const env = { today: todayISO(), dataFrom, dataTo, scope };
    const post = makePost();
    try {
      const r = post ? await askAgent(prompt, ctx, env, post) : null;
      const spec = r?.report ?? planReport(prompt, ctx, env.today);
      setCur({ prompt, spec });
      if (r?.note) setNote(r.note);
    } finally { setBusy(false); }
  };

  const exportPdf = async () => {
    if (!cur) return;
    const html = reportToHtml(withScope(cur.spec, scope), ctx, dataTo);
    if (Platform.OS === 'web') { await Print.printAsync({ html }); return; }
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: cur.spec.title });
  };

  return (
    <Screen max={900}>
      <ScreenHeader title="Reports" sub="Describe what you want to see. You get interactive charts." />
      <AskBox placeholder="e.g. Fuel and medical since July, by store" cta="Build report" suggestions={SUGGEST} busy={busy} onSubmit={build} />
      {note ? <Banner tone="info" title={note} /> : null}
      {cur ? (
        <View style={{ gap: S.md }}>
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            <Button small label={cur.saved ? 'Saved' : 'Save report'} disabled={cur.saved} onPress={() => { saveReport(cur.prompt, cur.spec); setCur({ ...cur, saved: true }); }} />
            <Button small kind="outline" label="Export PDF" onPress={exportPdf} />
            <Button small kind="ghost" label="Close" onPress={() => setCur(null)} />
          </View>
          <ReportView spec={withScope(cur.spec, scope)} ctx={ctx} colorOf={colorOf} dataTo={dataTo} completeTo={completeTo} />
        </View>
      ) : null}
      <Card title="Saved reports">
        {overlay.savedReports.length ? overlay.savedReports.map((r) => (
          <View key={r.id} style={{ gap: 4 }}>
            <Row label={r.spec.title} value={dayLabel(r.createdAt.slice(0, 10))} />
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <Button small kind="outline" label="Open" onPress={() => setCur({ prompt: r.prompt, spec: r.spec, saved: true })} />
              <Button small kind="ghost" label="Delete" onPress={() => deleteReport(r.id)} />
            </View>
          </View>
        )) : <T size={13} tone="ink2">Nothing saved yet. Build a report, then save it to reopen with fresh numbers.</T>}
      </Card>
    </Screen>
  );
}
