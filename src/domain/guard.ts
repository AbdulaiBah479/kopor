// Rules that stop common staff fraud before it happens (the server enforces the date rule too: migration 0031).
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { can } from '@/db/permissions';
import { addDays, today } from '@/lib/dates';
import { AppError } from './book';

/**
 * The date of a new record. Cashiers may record only today or yesterday (yesterday for entries made after midnight
 * or on a phone that was offline); putting sales, payments or stock on older or future days hides them from the day's
 * cash count. Managers and owners may correct any day.
 */
export function recordDate(ctx: Ctx, date?: string | null): string {
  const d = date || today();
  if (!can(ctx.role, 'edit') && (d < addDays(today(), -1) || d > today())) throw new AppError('err.backdated');
  return d;
}

/** Owner's credit limit per customer: a cashier cannot take a customer above it (a manager or owner can). */
export async function checkCreditLimit(ctx: Ctx, contactId: string, extra: number) {
  if (can(ctx.role, 'edit')) return;
  const limit = (await db.orgs.get(ctx.orgId))?.credit_limit;
  if (!limit) return;
  const rows = await db.ledger.where('contact_id').equals(contactId).toArray();
  const owes = rows.filter((e) => !e.deleted).reduce((s, e) => s + (e.type === 'gave' ? e.amount : -e.amount), 0);
  if (owes + extra > limit) throw new AppError('err.creditLimit', { limit: limit / 100, owes: Math.max(0, owes) / 100 });
}
