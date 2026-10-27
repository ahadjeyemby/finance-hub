// Prints each dashboard widget's readiness for every fictional fixture (src/dev/fixture.ts). A quick check while building widgets:
//   node --import tsx scripts/fixture-readiness.ts [full|gapped|sparse|empty|none] [all|personal|business]
import { dashboardData } from '../src/core/dashboard';
import type { Scope } from '../src/core/dashboard';
import { applyOverlay } from '../src/core/queries';
import { buildQuestions } from '../src/core/questions';
import { fixture, isFixtureKind } from '../src/dev/fixture';

const kinds = isFixtureKind(process.argv[2]) ? [process.argv[2]] : (['full', 'gapped', 'sparse', 'empty', 'none'] as const);
const scope = (process.argv[3] as Scope) ?? 'all';
for (const kind of kinds) {
  const f = fixture(kind);
  const txns = applyOverlay(f.txns, f.overlay);
  const real = f.accounts.filter((a) => a.type !== 'cash');
  const dataTo = real.reduce((m, a) => (a.coverage.to > m ? a.coverage.to : m), '0000-00-00');
  const dataFrom = real.reduce((m, a) => (a.coverage.from < m ? a.coverage.from : m), '9999-99-99');
  const d = dashboardData({
    ctx: { txns, accounts: f.accounts, statements: f.statements, recurring: f.overlay.recurring }, questions: buildQuestions(txns, f.overlay),
    period: '2026-09', dataFrom: real.length ? dataFrom : '2026-10-22', dataTo: real.length ? dataTo : '2026-10-22', income: f.overlay.income ?? { sources: [], records: [], assign: {} }, receiptsWaiting: 0,
  }, scope);
  console.log(`\n${kind} (${scope})`);
  for (const [id, w] of Object.entries(d)) console.log(`  ${id.padEnd(14)} ${w.readiness.padEnd(8)} ${w.lock?.missing ?? w.ask?.text ?? ''}`);
}
