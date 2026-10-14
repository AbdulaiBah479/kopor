// A Book is an in-memory snapshot of one organisation's data. Small businesses have
// thousands (not millions) of rows, so computing reports in memory is fast and simple.
import { db, type Org, type Branch, type Member, type Contact, type LedgerEntry, type Txn, type Product, type StockMove, type Group, type Contribution, type Invoice, type PaymentRequest, type Closing } from '@/db/schema';
import { list } from '@/db/repo';

export interface Book {
  org: Org;
  branches: Branch[];
  members: Member[];
  contacts: Contact[];
  ledger: LedgerEntry[];
  txns: Txn[];
  products: Product[];
  moves: StockMove[];
  groups: Group[];
  contributions: Contribution[];
  invoices: Invoice[];
  payments: PaymentRequest[];
  closings: Closing[];
}

/** Error whose message is an i18n key (translated by the UI). */
export class AppError extends Error {
  constructor(public key: string, public params: Record<string, unknown> = {}) { super(key); }
}

export async function loadBook(orgId: string, branchId: string | null = null): Promise<Book | null> {
  const org = await db.orgs.get(orgId);
  if (!org || org.deleted) return null;
  const [branches, members, contacts, ledger, txns, products, moves, groups, contributions, invoices, payments, closings] = await Promise.all([
    list('branches', orgId), list('members', orgId), list('contacts', orgId), list('ledger', orgId), list('transactions', orgId),
    list('products', orgId), list('stock_moves', orgId), list('groups', orgId), list('contributions', orgId), list('invoices', orgId),
    list('payment_requests', orgId), list('closings', orgId),
  ]);
  const inBranch = <T extends { branch_id: string | null }>(rows: T[]) => (branchId ? rows.filter((r) => r.branch_id === branchId) : rows);
  return {
    org, branches, members, contacts, products, groups, contributions, payments,
    ledger: inBranch(ledger), txns: inBranch(txns), moves: inBranch(moves), invoices: inBranch(invoices), closings: inBranch(closings),
  };
}

export const byId = <T extends { id: string }>(rows: T[], id: string | null | undefined) => rows.find((r) => r.id === id);
const norm = (s: string) => s.trim().toLowerCase();
export const findByName = <T extends { name: string }>(rows: T[], name: string) => rows.find((r) => norm(r.name) === norm(name));
