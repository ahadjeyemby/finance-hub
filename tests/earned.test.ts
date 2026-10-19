import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listTxns, summarize } from '../src/core/queries';
import type { Ctx } from '../src/core/queries';
import type { Txn } from '../src/core/types';
import sample from '../src/data/seed/ledger.sample.json';

const ledger = sample as unknown as { accounts: Ctx['accounts']; txns: Txn[] };
const ctx: Ctx = { accounts: ledger.accounts, txns: ledger.txns };

// The Overview's Earned number and the list behind it must be the same rows: tapping Earned has to explain the number exactly.
test('the transactions behind Earned and Rewards add up to the number shown, in every scope', () => {
  const dates = ledger.txns.map((t) => t.date).sort();
  for (const [from, to] of [[dates[0], dates.at(-1)!], ['2026-03-01', '2026-03-31']] as const) {
    for (const scope of ['all', 'personal', 'business'] as const) {
      const s = summarize(ctx, from, to, scope);
      const earned = listTxns(ctx, { from, to, scope, kinds: ['income'] }, 100000).reduce((t, x) => t + x.cents, 0);
      const rewards = listTxns(ctx, { from, to, scope, kinds: ['rewards'] }, 100000).reduce((t, x) => t + x.cents, 0);
      assert.equal(earned, s.earned, `earned, ${scope}, ${from}..${to}`);
      assert.equal(rewards, s.rewards, `rewards, ${scope}, ${from}..${to}`);
    }
  }
});
