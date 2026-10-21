// Savings goals ("cashbox"): money set aside for rent, restock, school fees... Kopor only keeps the record: the money
// stays where the owner keeps it (cash box, Orange Money, Afrimoney, bank). Setting money aside is not an expense, so
// goals never change profit.
import type { SavingsGoal } from '@/db/schema';
import { insert, update, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today, daysBetween } from '@/lib/dates';
import { AppError, type Book } from './book';

export const KEPT_IN = ['cash', 'orange', 'afrimoney', 'qmoney', 'bank'] as const;

export function goalProgress(book: Book, goal: SavingsGoal, now = today()) {
  const saved = book.savingsMoves.filter((m) => m.goal_id === goal.id).reduce((s, m) => s + m.amount, 0);
  const left = Math.max(0, goal.target - saved);
  const days = goal.due_date ? daysBetween(now, goal.due_date) : null;
  // How much to put aside each week to reach the goal on time (null when there is no date or it has passed).
  // Rounded UP to whole Leones (Le 153, not Le 152.18), so following the advice always reaches the goal.
  const perWeek = left > 0 && days !== null && days > 0 ? Math.ceil(left / Math.max(1, days / 7) / 100) * 100 : null;
  return { saved, left, pct: Math.min(100, Math.round((saved / goal.target) * 100)), reached: saved >= goal.target, days, perWeek };
}

export interface GoalInput { name: string; target: number; due_date?: string | null; kept_in?: string }
export async function saveGoal(ctx: Ctx, input: GoalInput, id?: string) {
  assertCan(ctx.role, 'record');
  if (!input.name.trim()) throw new AppError('err.nameRequired');
  if (!(input.target > 0)) throw new AppError('err.amount');
  const data = { name: input.name.trim().slice(0, 80), target: Math.round(input.target), due_date: input.due_date || null, kept_in: input.kept_in || 'cash' };
  if (id) return update(ctx, 'savings_goals', id, data, `Edited savings goal ${data.name}`);
  return insert(ctx, 'savings_goals', { ...data, archived: 0 }, `New savings goal ${data.name}`);
}

/** Put money aside (positive) or take some out (negative). Cannot take out more than is saved. */
export async function moveSavings(ctx: Ctx, book: Book, goal: SavingsGoal, amount: number, note = '') {
  assertCan(ctx.role, 'record');
  if (!amount) throw new AppError('err.amount');
  if (amount < 0 && -amount > goalProgress(book, goal).saved) throw new AppError('errx.takeTooMuch');
  return insert(ctx, 'savings_moves', { goal_id: goal.id, amount: Math.round(amount), date: today(), note: note.trim() },
    `${amount > 0 ? 'Saved' : 'Took out'} ${Math.abs(amount) / 100} for ${goal.name}`);
}
