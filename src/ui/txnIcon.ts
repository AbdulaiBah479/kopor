// One recognisable icon per kind of money movement (Monzo-style activity): a bag for sales, a bus for transport…
import type { Txn } from '@/db/schema';

const BY_CATEGORY: Record<string, string> = {
  stock: 'box', rent: 'building', transport: 'bus', salaries: 'users', utilities: 'zap', phone: 'install', fuel: 'fuel',
  food: 'food', repairs: 'wrench', taxes: 'receipt', loan: 'coins', refund: 'undo', other: 'tag',
};
export const txnIcon = (x: Pick<Txn, 'type' | 'category'>) => (x.type === 'in' ? 'bag' : BY_CATEGORY[x.category] ?? 'tag');
