// Which Monime records are reversals to look at (kept apart from reversals.ts so tests can load it).
export interface MonimeTxn {
  id: string; type: 'credit' | 'debit'; amount?: { value: number }; timestamp: string;
  originatingReversal?: { originTxnId: string } | null; ownershipGraph?: { owner?: { id?: string; type?: string } | null } | null;
}

const WEEK = 7 * 86_400_000;
/** Reversals from the last 7 days in a page of Monime records (older ones were already looked at). */
export const recentReversals = (items: MonimeTxn[], now = Date.now()) =>
  items.filter((t) => t.originatingReversal?.originTxnId && now - Date.parse(t.timestamp) < WEEK);
