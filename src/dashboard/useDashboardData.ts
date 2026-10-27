import { useMemo } from 'react';

import { dashboardData } from '@/core/dashboard';
import type { DashboardData, Scope } from '@/core/dashboard';
import { useRepo } from '@/data/repo';

/**
 * Every widget's numbers and readiness for one view's scope, from the effective ledger the rest of the app uses (answers, rules and edits
 * already applied), so the dashboard can never disagree with the screens behind it. Computed in core/dashboard.ts, which the tests cover.
 */
export function useDashboardData(scope: Scope): DashboardData {
  const { ctx, questions, period, dataFrom, dataTo, income, links } = useRepo();
  const receiptsWaiting = (links?.receipts ?? []).filter((r) => r.date && r.date > dataTo).length;
  return useMemo(
    () => dashboardData({ ctx, questions, period, dataFrom, dataTo, income, receiptsWaiting }, scope),
    [ctx, questions, period, dataFrom, dataTo, income, receiptsWaiting, scope],
  );
}
