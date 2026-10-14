// Local offline database (IndexedDB via Dexie). Table and column names mirror the Supabase schema
// (supabase/migrations) so sync is a straight copy. Amounts are integer minor units.
import Dexie, { type Table } from 'dexie';

export type Role = 'owner' | 'manager' | 'cashier' | 'viewer';
export type Method = 'cash' | 'orange' | 'afrimoney' | 'qmoney' | 'bank' | 'card' | 'credit';

export interface Base {
  id: string;
  org_id: string;
  created_at: number;
  updated_at: number;
  deleted: 0 | 1;
  created_by: string | null;
  dirty?: 0 | 1; // local only: 1 = not yet pushed to the cloud
}

/** A business, group or institution. org_id equals id so every table syncs the same way. */
export interface Org extends Base {
  name: string; type: string; currency: string; country_code: string;
  phone: string; address: string; momo_number: string; owner_name: string;
  reminder_days: number; plan: 'free' | 'pro';
  plan_until?: number | null;   // set only by the server when Pro is paid
  tax_rate?: number;            // percent, e.g. 15 for Sierra Leone GST
  tax_inclusive?: 0 | 1;        // 1 = prices already include tax
  tax_id?: string;              // TIN shown on invoices
  receipt_footer?: string;
}
export interface Branch extends Base { name: string; address: string }
export interface Member extends Base {
  user_id: string | null; name: string; phone: string; role: Role;
  branch_id: string | null; active: 0 | 1; // PIN hashes are device-local (meta 'pins'), never synced
}
export interface Contact extends Base { name: string; phone: string; kind: 'customer' | 'supplier'; notes: string }
export interface LedgerEntry extends Base {
  branch_id: string | null; contact_id: string; type: 'gave' | 'got'; amount: number;
  note: string; date: string; due_date: string | null; ref_type: string | null; ref_id: string | null;
}
export interface LineItem { product_id: string | null; name: string; qty: number; price: number; cost: number }
export interface Txn extends Base {
  branch_id: string | null; type: 'in' | 'out'; category: string; amount: number; method: Method;
  contact_id: string | null; note: string; date: string; items: LineItem[];
  ledger_id: string | null; invoice_id: string | null;
  discount?: number;            // minor units taken off the subtotal
  tax?: number;                 // minor units of tax included in `amount`
  refund_of?: string | null;    // for category 'refund': the sale being returned
}
export interface Product extends Base { name: string; sku: string; unit: string; price: number; cost: number; low_at: number }
export interface StockMove extends Base {
  branch_id: string | null; product_id: string; qty: number;
  reason: 'opening' | 'sale' | 'restock' | 'adjust' | 'reversal' | 'return'; ref_id: string | null; date: string;
}
export interface GroupMember { id: string; name: string; phone: string }
export interface Group extends Base {
  name: string; kind: 'osusu' | 'dues'; amount: number; frequency: 'daily' | 'weekly' | 'monthly';
  start_date: string; members: GroupMember[]; payouts: Record<string, string>;
}
export interface Contribution extends Base {
  group_id: string; member_id: string; round: number; amount: number; date: string; method: Method; payment_ref: string | null;
}
export interface Invoice extends Base {
  branch_id: string | null; number: string; contact_id: string | null; customer: string; phone: string;
  items: LineItem[]; date: string; due_date: string | null; notes: string;
  status: 'unpaid' | 'paid' | 'void'; paid_date: string | null; public_token: string; txn_id: string | null; ledger_id: string | null;
  discount?: number; tax?: number; total?: number; // total = what the customer pays (after discount, with tax)
}
/** End-of-day cash count: what the drawer should hold vs what was counted. */
export interface Closing extends Base {
  branch_id: string | null; date: string; opening_float: number; expected: number; counted: number; difference: number; note: string;
}
export interface PaymentRequest extends Base {
  kind: 'checkout' | 'ussd' | 'payout'; invoice_id: string | null; group_id: string | null; amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'cancelled';
  provider_ref: string | null; url: string | null; ussd_code: string | null; phone: string | null; note: string;
}
export interface AuditEntry extends Base { member_name: string; action: 'create' | 'update' | 'delete'; entity: string; entity_id: string; summary: string; at: number }
export interface Meta { key: string; value: unknown }

export const SYNC_TABLES = [
  'orgs', 'branches', 'members', 'contacts', 'ledger', 'transactions', 'products', 'stock_moves',
  'groups', 'contributions', 'invoices', 'payment_requests', 'closings', 'audit',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export interface RowOf {
  orgs: Org; branches: Branch; members: Member; contacts: Contact; ledger: LedgerEntry; transactions: Txn;
  products: Product; stock_moves: StockMove; groups: Group; contributions: Contribution; invoices: Invoice;
  payment_requests: PaymentRequest; closings: Closing; audit: AuditEntry;
}

export class KoporDB extends Dexie {
  orgs!: Table<Org, string>;
  branches!: Table<Branch, string>;
  members!: Table<Member, string>;
  contacts!: Table<Contact, string>;
  ledger!: Table<LedgerEntry, string>;
  transactions!: Table<Txn, string>;
  products!: Table<Product, string>;
  stock_moves!: Table<StockMove, string>;
  groups!: Table<Group, string>;
  contributions!: Table<Contribution, string>;
  invoices!: Table<Invoice, string>;
  payment_requests!: Table<PaymentRequest, string>;
  closings!: Table<Closing, string>;
  audit!: Table<AuditEntry, string>;
  meta!: Table<Meta, string>;

  constructor(name = 'kopor2') {
    super(name);
    this.version(1).stores({
      orgs: 'id, dirty',
      branches: 'id, org_id, dirty',
      members: 'id, org_id, user_id, dirty',
      contacts: 'id, org_id, dirty',
      ledger: 'id, org_id, contact_id, dirty',
      transactions: 'id, org_id, date, dirty',
      products: 'id, org_id, dirty',
      stock_moves: 'id, org_id, product_id, ref_id, dirty',
      groups: 'id, org_id, dirty',
      contributions: 'id, org_id, group_id, dirty',
      invoices: 'id, org_id, public_token, dirty',
      payment_requests: 'id, org_id, invoice_id, dirty',
      audit: 'id, org_id, at, dirty',
      meta: 'key',
    });
    // v2: end-of-day cash closings (new columns on existing tables need no migration in IndexedDB).
    this.version(2).stores({ closings: 'id, org_id, date, dirty' });
  }
  /** Typed access to a synced table by name. */
  t<K extends SyncTable>(name: K): Table<RowOf[K], string> {
    return this.table(name) as Table<RowOf[K], string>;
  }
}

export const db = new KoporDB();
