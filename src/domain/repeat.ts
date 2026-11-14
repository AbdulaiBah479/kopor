// Repeat invoices (migration 0049): an invoice can repeat every month (rent, school fees, a monthly supply). When a
// manager's phone opens Kopor, each month that is due is created through the normal invoice code (so the sale, the
// debt and any stock are recorded as usual) and is ready to send. Before creating one, the phone claims that month on
// the server, so two phones can never create the same month twice; offline, it waits until the phone is online.
import type { Invoice } from '@/db/schema';
import { update, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { addDays, daysBetween, today } from '@/lib/dates';
import { getSupabase } from '@/cloud/supabase';
import { createInvoice, isQuote } from './invoices';
import { monthsLater } from './instalments';
import type { Book } from './book';

export const repeatsDue = (book: Book, now = today()) => book.invoices.filter((i) =>
  !i.deleted && i.repeat_every === 'month' && i.repeat_next && i.repeat_next <= now && i.status !== 'void' && !isQuote(i));

/** Switch monthly repeating on (next month, same day) or off. */
export function setRepeat(ctx: Ctx, inv: Invoice, on: boolean) {
  assertCan(ctx.role, 'edit');
  return update(ctx, 'invoices', inv.id, on ? { repeat_every: 'month', repeat_next: monthsLater(inv.date, 1) } : { repeat_every: null, repeat_next: null },
    on ? `Invoice ${inv.number} repeats every month` : `Invoice ${inv.number} stops repeating`);
}

/** May this phone create the month starting on `period`? Always without a cloud sign-in (one phone only). */
async function claim(orgId: string, templateId: string, period: string): Promise<boolean> {
  const sb = await getSupabase();
  if (!sb) return true;
  // Not signed in to the cloud: this phone is the business's only copy, so there is nobody to clash with.
  const { data: auth } = await sb.auth.getSession().catch(() => ({ data: { session: null } }));
  if (!auth.session) return true;
  const { data, error } = await sb.rpc('kopor_claim_repeat', { o: orgId, t: templateId, p: period });
  if (error) return false; // offline or not allowed: try again next time
  return data === true;
}

/** Create every month that is due; returns the new invoices. */
export async function runRepeats(ctx: Ctx, book: Book, now = today()): Promise<Invoice[]> {
  if (ctx.role !== 'owner' && ctx.role !== 'manager') return [];
  const made: Invoice[] = [];
  for (const tpl of repeatsDue(book, now)) {
    let next = tpl.repeat_next!;
    const dueAfter = tpl.due_date ? Math.max(0, daysBetween(tpl.date, tpl.due_date)) : 14;
    // Catch up at most 3 months at once (a phone that was away for a long time).
    for (let i = 0; i < 3 && next <= now; i++) {
      if (!(await claim(ctx.orgId, tpl.id, next))) break;
      made.push(await createInvoice(ctx, {
        customer: tpl.customer, phone: tpl.phone, items: tpl.items.map(({ product_id, name, qty, price, cost }) => ({ product_id, name, qty, price, cost })),
        date: next, dueDate: addDays(next, dueAfter), notes: tpl.notes, paid: false, discount: tpl.discount ?? 0,
      }));
      next = monthsLater(next, 1);
      await update(ctx, 'invoices', tpl.id, { repeat_next: next }, `Repeat invoice for ${tpl.customer}`);
    }
  }
  return made;
}
