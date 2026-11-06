import { describe, it, expect } from 'vitest';
import { recentReversals, type MonimeTxn } from '../../supabase/functions/_shared/reversalPick';

describe('mobile money reversals', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const txn = (id: string, days: number, origin?: string): MonimeTxn => ({
    id, type: origin ? 'debit' : 'credit', amount: { value: 50_000 }, timestamp: new Date(now - days * 86_400_000).toISOString(),
    originatingReversal: origin ? { originTxnId: origin } : null,
  });
  it('picks only reversals from the last week', () => {
    const page = [txn('a', 0), txn('r1', 1, 'a'), txn('r2', 9, 'b'), txn('c', 2)];
    expect(recentReversals(page, now).map((t) => t.id)).toEqual(['r1']);
  });
});
