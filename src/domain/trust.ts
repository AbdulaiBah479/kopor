// Customer trust score: before giving goods on credit, how well has this customer paid back before? Each credit is
// matched with the payments that followed it, oldest first, giving how many days each one took to clear (or has been
// open so far). Worked out from the shop's own records only; nothing leaves the phone.
import type { LedgerEntry } from '@/db/schema';
import { daysBetween, today } from '@/lib/dates';

export type Trust = 'new' | 'good' | 'slow' | 'risky';
export interface TrustScore { level: Trust; credits: number; avgDays: number; oldestOpenDays: number; onTime: number }

const GOOD_DAYS = 14, SLOW_DAYS = 30, RISKY_OPEN = 60;

export function trustOf(ledger: LedgerEntry[], contactId: string, now = today()): TrustScore {
  const rows = ledger.filter((e) => e.contact_id === contactId && !e.deleted)
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at);
  // Payments clear the oldest open credit first; money paid before any credit (an advance, or paying small-small
  // towards goods) clears the next credit the day it is given.
  const credits: { date: string; left: number; cleared: string | null }[] = [];
  let advance = 0;
  for (const e of rows) {
    if (e.type === 'gave') {
      const c = { date: e.date, left: e.amount, cleared: null as string | null };
      const used = Math.min(advance, c.left);
      c.left -= used; advance -= used;
      if (c.left <= 0) c.cleared = e.date;
      credits.push(c);
      continue;
    }
    let money = e.amount;
    for (const c of credits) {
      if (money <= 0) break;
      if (c.cleared) continue;
      const used = Math.min(money, c.left);
      c.left -= used; money -= used;
      if (c.left <= 0) c.cleared = e.date;
    }
    advance += money;
  }
  const days = credits.map((c) => Math.max(0, daysBetween(c.date, c.cleared ?? now)));
  const cleared = credits.filter((c) => c.cleared);
  const avgDays = cleared.length ? Math.round(cleared.reduce((s, c) => s + daysBetween(c.date, c.cleared!), 0) / cleared.length) : 0;
  const open = credits.filter((c) => !c.cleared).map((c) => daysBetween(c.date, now));
  const oldestOpenDays = open.length ? Math.max(...open) : 0;
  const onTime = credits.length ? Math.round((days.filter((d) => d <= GOOD_DAYS).length / credits.length) * 100) : 0;
  let level: Trust;
  if (credits.length < 2 && oldestOpenDays <= SLOW_DAYS) level = 'new';
  else if (oldestOpenDays > RISKY_OPEN || avgDays > SLOW_DAYS) level = 'risky';
  else if (oldestOpenDays > SLOW_DAYS || avgDays > GOOD_DAYS) level = 'slow';
  else level = 'good';
  return { level, credits: credits.length, avgDays, oldestOpenDays, onTime };
}
