// Staff attendance and salaries. Attendance is one row per person per day; pay is worked out each month from the
// salary (or daily rate), the days marked absent, bonuses, deductions and advances. Advances and salary payments are
// also cash-book expenses (category "salaries"), so profit and the cash in the drawer stay right.
import type { Attendance, Member, StaffPay, StaffTerms } from '@/db/schema';
import { db } from '@/db/schema';
import { atomic, insert, update, type Ctx } from '@/db/repo';
import { assertCan, can, PermissionError } from '@/db/permissions';
import { today } from '@/lib/dates';
import { AppError, type Book } from './book';
import { recordExpense, type ExpenseInput } from './cash';

export const STATUSES = ['present', 'late', 'half', 'absent', 'leave', 'off'] as const;
export type Status = (typeof STATUSES)[number];
/** Tapping in after this time counts as late. */
export const LATE_AFTER = '08:30';

export const monthOf = (iso: string) => iso.slice(0, 7);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** The same id on every phone for one person's day, so two phones marking it offline update one row, not two. */
export async function attendanceId(orgId: string, memberId: string, date: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`attendance:${orgId}:${memberId}:${date}`)));
  hash[6] = (hash[6] & 0x0f) | 0x40; hash[8] = (hash[8] & 0x3f) | 0x80; // looks like a normal (version 4) id
  const h = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** People on the register: everyone active in the team. */
export const staffOf = (book: Book) => book.members.filter((m) => m.active === 1);
export const dayOf = (book: Book, memberId: string, date: string) => book.attendance.find((a) => a.member_id === memberId && a.date === date);

/** Staff (cashiers) may mark only themselves; managers and owners anyone. Same rule on the server (0022). */
function assertMayMark(ctx: Ctx, memberId: string) {
  if (can(ctx.role, 'edit')) return;
  if (can(ctx.role, 'record') && ctx.memberId === memberId) return;
  throw new PermissionError('edit');
}

export async function markDay(ctx: Ctx, member: Member, date: string, patch: Partial<Pick<Attendance, 'status' | 'time_in' | 'time_out' | 'note'>>) {
  assertMayMark(ctx, member.id);
  if (patch.status && !STATUSES.includes(patch.status)) throw new AppError('err.generic');
  const id = await attendanceId(ctx.orgId, member.id, date);
  const cur = await db.attendance.get(id);
  const summary = `${member.name}: ${patch.status ?? (patch.time_out ? 'left' : 'arrived')} ${date}`;
  if (cur) return update(ctx, 'attendance', id, { ...patch, deleted: 0 }, summary);
  return insert(ctx, 'attendance', { id, member_id: member.id, date, status: patch.status ?? 'present', time_in: patch.time_in ?? null, time_out: patch.time_out ?? null, note: patch.note ?? '' }, summary);
}

/** Arriving now: present, or late after LATE_AFTER. Keeps the first arrival time if already tapped in. */
export async function tapIn(ctx: Ctx, book: Book, member: Member, now = new Date()) {
  const date = today(), time = hhmm(now), cur = dayOf(book, member.id, date);
  if (cur?.time_in) return cur;
  return markDay(ctx, member, date, { status: time > LATE_AFTER ? 'late' : 'present', time_in: time });
}
export async function tapOut(ctx: Ctx, book: Book, member: Member, now = new Date()) {
  const date = today(), cur = dayOf(book, member.id, date);
  return markDay(ctx, member, date, { time_out: hhmm(now), ...(cur ? {} : { status: 'present' as Status }) });
}

/** Working days in a month: Monday first, so 6 = Monday to Saturday, 5 = Monday to Friday, 7 = every day. */
export function workingDays(month: string, workDays = 6, upTo?: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days: string[] = [];
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    if (upTo && iso > upTo) break;
    const weekday = ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1; // Monday 1 ... Sunday 7
    if (weekday <= workDays) days.push(iso);
  }
  return days;
}

export function monthCounts(book: Book, memberId: string, month: string) {
  const c: Record<Status, number> = { present: 0, late: 0, half: 0, absent: 0, leave: 0, off: 0 };
  for (const a of book.attendance) if (a.member_id === memberId && a.date.startsWith(month)) c[a.status]++;
  return c;
}

export const termsOf = (book: Book, memberId: string): StaffTerms | undefined => book.staffTerms.find((t) => t.member_id === memberId);

/**
 * What a person has earned this month and what is still to pay them.
 * Monthly salary: the full salary, less a day's pay for each absent day (half for a half day). Days not marked count
 * as worked, so forgetting to mark never cuts anyone's pay. Daily rate: paid for days marked present, late or half.
 * Paid leave and days off are not deducted.
 */
export function payFor(book: Book, memberId: string, month: string) {
  const terms = termsOf(book, memberId);
  const c = monthCounts(book, memberId, month);
  const wd = workingDays(month, terms?.work_days ?? 6).length;
  const rows = book.staffPay.filter((p) => p.member_id === memberId && p.month === month);
  const sum = (k: StaffPay['kind']) => rows.filter((p) => p.kind === k).reduce((s, p) => s + p.amount, 0);
  let earned = 0;
  if (terms?.pay_type === 'daily') earned = Math.round(terms.amount * (c.present + c.late + c.half * 0.5));
  else if (terms) earned = Math.max(0, Math.round(terms.amount - (terms.amount / Math.max(1, wd)) * (c.absent + c.half * 0.5)));
  const bonus = sum('bonus'), deduction = sum('deduction'), advances = sum('advance'), paid = sum('salary');
  const due = Math.max(0, earned + bonus - deduction - advances);
  return { terms, counts: c, workingDays: wd, earned, bonus, deduction, advances, paid, due, balance: due - paid, rows };
}

export interface TermsInput { pay_type: 'monthly' | 'daily'; amount: number; work_days: number }
export async function saveTerms(ctx: Ctx, book: Book, member: Member, i: TermsInput) {
  assertCan(ctx.role, 'team');
  if (!(i.amount >= 0)) throw new AppError('err.amount');
  const data = { pay_type: i.pay_type, amount: Math.round(i.amount), work_days: Math.min(7, Math.max(1, Math.round(i.work_days || 6))) };
  const cur = termsOf(book, member.id);
  if (cur) return update(ctx, 'staff_terms', cur.id, data, `Pay for ${member.name}`);
  return insert(ctx, 'staff_terms', { member_id: member.id, start_date: today(), ...data }, `Pay for ${member.name}`);
}

/**
 * Record an advance, a salary payment, a bonus or a deduction. Advances and salary payments are money out, so they
 * also go in the cash book as an expense ("salaries"); bonuses and deductions only change what is owed.
 */
export async function recordPay(ctx: Ctx, member: Member, kind: StaffPay['kind'], amount: number, opts: { month?: string; method?: ExpenseInput['method']; note?: string } = {}) {
  assertCan(ctx.role, 'edit');
  if (!(amount > 0)) throw new AppError('err.amount');
  const month = opts.month ?? monthOf(today());
  const cash = kind === 'advance' || kind === 'salary';
  return atomic(async () => {
    const txn = cash ? await recordExpense(ctx, { amount, category: 'salaries', method: opts.method ?? 'cash', note: `${kind === 'advance' ? 'Advance' : 'Salary'} · ${member.name} · ${month}${opts.note ? ` · ${opts.note}` : ''}` }) : null;
    return insert(ctx, 'staff_pay', { member_id: member.id, kind, amount: Math.round(amount), month, date: today(), note: (opts.note ?? '').trim().slice(0, 200), txn_id: txn?.id ?? null },
      `${kind} ${amount / 100} for ${member.name}`);
  });
}
