import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '@/db/schema';
import { trustOf } from '@/domain/trust';
import { salesToday } from '@/ui/TargetCard';
import type { Book } from '@/domain/book';

let n = 0;
const e = (type: 'gave' | 'got', amount: number, date: string): LedgerEntry => ({
  id: `e${++n}`, org_id: 'o', created_at: n, updated_at: n, deleted: 0, created_by: null, rev: 0, dirty: 0,
  branch_id: null, contact_id: 'c', type, amount, note: '', date, due_date: null, ref_type: null, ref_id: null,
} as LedgerEntry);
const NOW = '2026-11-10';

describe('customer trust score', () => {
  it('a customer with little history is new', () => {
    expect(trustOf([e('gave', 1000, '2026-11-01')], 'c', NOW).level).toBe('new');
  });
  it('pays back within two weeks: good', () => {
    const s = trustOf([e('gave', 1000, '2026-09-01'), e('got', 1000, '2026-09-05'), e('gave', 2000, '2026-10-01'), e('got', 2000, '2026-10-10')], 'c', NOW);
    expect(s).toMatchObject({ level: 'good', credits: 2, avgDays: 7, onTime: 100 });
  });
  it('takes a month: slow; part payments count towards the oldest credit first', () => {
    const s = trustOf([e('gave', 1000, '2026-08-01'), e('got', 500, '2026-08-10'), e('got', 500, '2026-08-25'), e('gave', 1000, '2026-09-01'), e('got', 1000, '2026-09-26')], 'c', NOW);
    expect(s.level).toBe('slow');
    expect(s.avgDays).toBe(25);                       // 24 and 25 days
  });
  it('a credit unpaid for over two months: risky', () => {
    const s = trustOf([e('gave', 1000, '2026-07-01'), e('got', 1000, '2026-07-03'), e('gave', 3000, '2026-08-20')], 'c', NOW);
    expect(s.level).toBe('risky');
    expect(s.oldestOpenDays).toBeGreaterThan(60);
  });
});

describe('daily sales target', () => {
  it('counts today’s sales less refunds', () => {
    const tx = (type: 'in' | 'out', category: string, amount: number, date = NOW) => ({ deleted: 0, type, category, amount, date });
    const book = { txns: [tx('in', 'sale', 5000), tx('in', 'sale', 3000), tx('out', 'refund', 1000), tx('out', 'rent', 9999), tx('in', 'sale', 7000, '2026-11-09')] } as unknown as Book;
    expect(salesToday(book, NOW)).toBe(7000);
  });
});
