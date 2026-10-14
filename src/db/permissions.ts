// Role-based access control. The same rules are enforced in Postgres row-level security
// (supabase/migrations/0002_security.sql); the UI uses these to hide what a role cannot do.
import type { Role } from './schema';

const RANK: Record<Role, number> = { viewer: 0, cashier: 1, manager: 2, owner: 3 };

export const PERMS = {
  view: 'viewer',
  record: 'cashier',          // sales, expenses, credit entries, contributions, invoices
  close: 'cashier',           // count the drawer at the end of the day
  returns: 'manager',         // refunds are a common fraud route, so managers approve them
  edit: 'manager',            // change or delete existing records
  stock: 'manager',           // products, restocks, adjustments
  groups: 'manager',          // create/edit osusu & dues groups
  reports: 'manager',         // health score, loan report, audit log
  payments: 'manager',        // request payments
  payouts: 'owner',           // send money out
  team: 'owner',              // staff, roles, branches
  business: 'owner',          // business settings, export, delete
} as const satisfies Record<string, Role>;
export type Perm = keyof typeof PERMS;

export const can = (role: Role | undefined, perm: Perm) => !!role && RANK[role] >= RANK[PERMS[perm]];
export const ROLES: Role[] = ['owner', 'manager', 'cashier', 'viewer'];

export class PermissionError extends Error {
  constructor(perm: Perm) { super(`Your role is not allowed to do this (${perm}). Ask the owner.`); }
}
export function assertCan(role: Role, perm: Perm) { if (!can(role, perm)) throw new PermissionError(perm); }
