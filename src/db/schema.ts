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
  shop_lat?: number | null;     // the shop's location, to check staff tap in at the shop (Staff & attendance)
  shop_lng?: number | null;
  late_after?: string | null;   // HH:MM, tapping in later counts as late (default 08:30)
  away_m?: number | null;       // metres from the shop that still count as "at the shop" (default 200)
  pro_trial_at?: string | null; // when this business used its free Pro trial (set by the server)
  credit_limit?: number | null; // minor units: cashiers cannot take one customer above this (null = no limit)
  track_live?: 0 | 1;           // 1 = managers see staff positions live while they are tapped in (staff agree first)
}
export interface Branch extends Base { name: string; address: string }
export interface Member extends Base {
  user_id: string | null; name: string; phone: string; role: Role;
  branch_id: string | null; active: 0 | 1; // PIN hashes are device-local (meta 'pins'), never synced
}
export interface Contact extends Base { name: string; phone: string; kind: 'customer' | 'supplier'; notes: string; public_token?: string | null }
export interface LedgerEntry extends Base {
  branch_id: string | null; contact_id: string; type: 'gave' | 'got'; amount: number;
  note: string; date: string; due_date: string | null; ref_type: string | null; ref_id: string | null;
  verified_ref?: string | null; // set only by the server when Monime confirmed the money
}
/** per = pieces in one unit sold (a carton of 24 is per 24); stock goes down by qty × per. */
export interface LineItem { product_id: string | null; name: string; qty: number; price: number; cost: number; per?: number }
export interface Txn extends Base {
  branch_id: string | null; type: 'in' | 'out'; category: string; amount: number; method: Method;
  contact_id: string | null; note: string; date: string; items: LineItem[];
  ledger_id: string | null; invoice_id: string | null;
  discount?: number;            // minor units taken off the subtotal
  tax?: number;                 // minor units of tax included in `amount`
  refund_of?: string | null;    // for category 'refund': the sale being returned
  verified_ref?: string | null; // set only by the server when Monime confirmed the money ("Confirmed by Monime")
}
export interface Product extends Base {
  name: string; sku: string; unit: string; price: number; cost: number; low_at: number;
  pack_size?: number | null; pack_price?: number | null; pack_name?: string | null; // also sold by the carton: pack_size pieces at pack_price
}
export interface StockMove extends Base {
  branch_id: string | null; product_id: string; qty: number;
  reason: 'opening' | 'sale' | 'restock' | 'adjust' | 'reversal' | 'return'; ref_id: string | null; date: string;
  expiry?: string | null; // expiry date of the goods received (restock / opening)
}
export interface GroupMember { id: string; name: string; phone: string }
export interface Group extends Base {
  // savings = savings & loan group (VSLA): members save, borrow from the pot, repay with interest, then share out.
  name: string; kind: 'osusu' | 'dues' | 'savings'; amount: number; frequency: 'daily' | 'weekly' | 'monthly';
  start_date: string; members: GroupMember[]; payouts: Record<string, string>;
  target?: number | null; loan_interest?: number; public_token?: string | null;
}
/** A loan from a group's pot (interest = the flat interest the group charges) or a repayment of it. */
export interface GroupLoan extends Base {
  group_id: string; member_id: string; type: 'loan' | 'repay'; amount: number; interest: number; date: string; due_date: string | null; note: string;
}
/** Money set aside for a purpose ("cashbox"): Kopor only keeps the record; the money stays where it is kept. */
export interface SavingsGoal extends Base { name: string; target: number; due_date: string | null; kept_in: string; archived: 0 | 1 }
export interface SavingsMove extends Base { goal_id: string; amount: number; date: string; note: string }
/** One staff member's day: one row per member per day (id made from member + date, see domain/staff.ts). */
export interface Attendance extends Base {
  member_id: string; date: string; status: 'present' | 'late' | 'half' | 'absent' | 'leave' | 'off';
  time_in: string | null; time_out: string | null; note: string;
  where_m?: number | null;      // metres from the shop when tapping in (only the distance is kept)
  seen_at?: string | null;      // when Kopor's server first got it (set by the server, so a changed phone clock shows)
}
/** How a staff member is paid. Only managers and owners can read it (server rule in 0022). */
export interface StaffTerms extends Base { member_id: string; pay_type: 'monthly' | 'daily'; amount: number; work_days: number; start_date: string | null }
/** Advances, salary payments, bonuses and deductions for a month (YYYY-MM). txn_id = the cash-book expense it made. */
export interface StaffPay extends Base {
  member_id: string; kind: 'advance' | 'salary' | 'bonus' | 'deduction'; amount: number; month: string; date: string; note: string; txn_id: string | null;
}
/** A member's "I've paid" from the group link: counts only after the treasurer approves it. */
export interface GroupClaim extends Base {
  group_id: string; member_id: string; kind: 'contribution' | 'repay'; round: number | null; amount: number;
  method: 'cash' | 'orange' | 'afrimoney' | 'qmoney' | 'bank'; ref: string; note: string; status: 'pending' | 'approved' | 'rejected';
}
export interface Contribution extends Base {
  group_id: string; member_id: string; round: number; amount: number; date: string; method: Method; payment_ref: string | null;
}
export interface Invoice extends Base {
  branch_id: string | null; number: string; contact_id: string | null; customer: string; phone: string;
  items: LineItem[]; date: string; due_date: string | null; notes: string;
  // 'quote' = a quotation (records nothing yet); 'accepted' = a quotation that was turned into an invoice.
  status: 'unpaid' | 'paid' | 'void' | 'quote' | 'accepted'; paid_date: string | null; public_token: string; txn_id: string | null; ledger_id: string | null;
  discount?: number; tax?: number; total?: number; // total = what the customer pays (after discount, with tax)
}
/** End-of-day cash count: what the drawer should hold vs what was counted. */
export interface Closing extends Base {
  branch_id: string | null; date: string; opening_float: number; expected: number; counted: number; difference: number; note: string;
  /** Mobile money check: per network, what the books expect and what the owner's phone messages show. */
  momo?: Partial<Record<'orange' | 'afrimoney' | 'qmoney', { expected: number; counted: number }>>;
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
  'groups', 'contributions', 'invoices', 'payment_requests', 'closings', 'group_loans', 'savings_goals', 'savings_moves', 'group_claims',
  'attendance', 'staff_terms', 'staff_pay', 'audit',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export interface RowOf {
  orgs: Org; branches: Branch; members: Member; contacts: Contact; ledger: LedgerEntry; transactions: Txn;
  products: Product; stock_moves: StockMove; groups: Group; contributions: Contribution; invoices: Invoice;
  payment_requests: PaymentRequest; closings: Closing; group_loans: GroupLoan; savings_goals: SavingsGoal; savings_moves: SavingsMove; group_claims: GroupClaim;
  attendance: Attendance; staff_terms: StaffTerms; staff_pay: StaffPay; audit: AuditEntry;
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
  group_loans!: Table<GroupLoan, string>;
  savings_goals!: Table<SavingsGoal, string>;
  savings_moves!: Table<SavingsMove, string>;
  group_claims!: Table<GroupClaim, string>;
  attendance!: Table<Attendance, string>;
  staff_terms!: Table<StaffTerms, string>;
  staff_pay!: Table<StaffPay, string>;
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
    // v3: savings & loan groups and savings goals.
    this.version(3).stores({ group_loans: 'id, org_id, group_id, dirty', savings_goals: 'id, org_id, dirty', savings_moves: 'id, org_id, goal_id, dirty' });
    // v4: members' payment claims from the group link.
    this.version(4).stores({ group_claims: 'id, org_id, group_id, dirty' });
    // v5: staff attendance and pay.
    this.version(5).stores({ attendance: 'id, org_id, member_id, date, dirty', staff_terms: 'id, org_id, member_id, dirty', staff_pay: 'id, org_id, member_id, dirty' });
  }
  /** Typed access to a synced table by name. */
  t<K extends SyncTable>(name: K): Table<RowOf[K], string> {
    return this.table(name) as Table<RowOf[K], string>;
  }
}

export const db = new KoporDB();
