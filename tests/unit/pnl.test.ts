import { describe, expect, it } from 'vitest';
import { pnl } from '@/domain/pnl';
import type { Book } from '@/domain/book';

const txn = (o: Record<string, unknown>) => ({ id: Math.random().toString(), date: '2026-10-10', tax: 0, discount: 0, items: [], method: 'cash', ...o });
const book = {
  txns: [
    txn({ type: 'in', category: 'sale', amount: 10_000, items: [{ name: 'Rice', qty: 2, price: 5_000, cost: 3_500 }] }),
    txn({ type: 'in', category: 'sale', amount: 2_300, tax: 300, items: [{ name: 'Oil', qty: 1, price: 2_000, cost: 1_200 }] }),
    txn({ type: 'out', category: 'stock', amount: 20_000 }),
    txn({ type: 'out', category: 'rent', amount: 1_500 }),
    txn({ type: 'out', category: 'transport', amount: 500 }),
    txn({ type: 'out', category: 'refund', amount: 2_300, tax: 300, items: [{ name: 'Oil', qty: 1, price: 2_000, cost: 1_200 }] }),
    txn({ type: 'out', category: 'rent', amount: 999, date: '2026-09-01' }),
  ],
} as unknown as Book;

describe('profit & loss', () => {
  it('counts cost of goods sold, not stock bought, and nets refunds', () => {
    const p = pnl(book, '2026-10-01', '2026-10-31');
    expect(p.revenue).toBe(10_000);           // 10,000 + 2,000 net of tax − 2,000 refunded
    expect(p.cogs).toBe(7_000);               // 2 × 3,500 (the refunded oil's cost comes back)
    expect(p.gross).toBe(3_000);
    expect(p.grossMargin).toBe(30);
    expect(p.expenses).toEqual([{ category: 'rent', amount: 1_500 }, { category: 'transport', amount: 500 }]);
    expect(p.operating).toBe(2_000);
    expect(p.net).toBe(1_000);
    expect(p.stockBought).toBe(20_000);       // shown separately, not an expense
    expect(p.cogsKnown).toBe(true);
  });
  it('is empty and safe for a period without records', () => {
    const p = pnl(book, '2025-01-01', '2025-01-31');
    expect(p).toMatchObject({ revenue: 0, cogs: 0, net: 0, grossMargin: 0, netMargin: 0, expenses: [] });
  });
});
