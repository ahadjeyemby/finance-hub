import { router } from 'expo-router';
import { createContext, useContext } from 'react';

/** What the transactions list can be filtered by: the same names the /ledger address takes. */
export type LedgerParams = { from?: string; to?: string; category?: string; merchant?: string; kinds?: string; tags?: string; group?: string };

export interface TxPanelApi {
  /** The transactions that match, in the panel on the right of whatever page is open. */
  openList: (params: LedgerParams) => void;
  /** One transaction, in the panel on the right. */
  openTxn: (id: string) => void;
  close: () => void;
}

// Outside the panel's provider the pages still work: they open as pages.
const asPages: TxPanelApi = {
  openList: (params) => router.push({ pathname: '/ledger', params }),
  openTxn: (id) => router.push({ pathname: '/txn/[id]', params: { id } }),
  close: () => {},
};

export const TxPanelContext = createContext<TxPanelApi>(asPages);
export const useTxPanel = () => useContext(TxPanelContext);
