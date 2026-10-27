// Business hours (same rule as kopor_open_now on the server, migration 0034). Sierra Leone time is UTC.
import type { Org } from '@/db/schema';

export const DEFAULT_OPEN = '08:00', DEFAULT_CLOSE = '18:00', DEFAULT_DAYS = 63; // Monday to Saturday
/** Bit for each day, Monday first (Monday = 1, Tuesday = 2, ... Sunday = 64). */
export const DAY_BITS = [1, 2, 4, 8, 16, 32, 64] as const;

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Is the business open at this moment? A closing time before the opening time means a night shift past midnight. */
export function isOpenNow(org: Pick<Org, 'open_at' | 'close_at' | 'work_days'>, at = new Date()): boolean {
  const days = org.work_days || DEFAULT_DAYS;
  const dow = (at.getUTCDay() + 6) % 7; // Monday = 0
  const now = at.getUTCHours() * 60 + at.getUTCMinutes();
  const open = minutes(org.open_at || DEFAULT_OPEN), close = minutes(org.close_at || DEFAULT_CLOSE);
  const works = (d: number) => (days & DAY_BITS[d]) !== 0;
  if (close > open) return works(dow) && now >= open && now < close;
  return (works(dow) && now >= open) || (works((dow + 6) % 7) && now < close);
}

/** "08:00–18:00 · Mon–Sat"-style summary pieces for the screens. */
export const hoursOf = (org: Pick<Org, 'open_at' | 'close_at' | 'work_days'>) => ({
  open: org.open_at || DEFAULT_OPEN, close: org.close_at || DEFAULT_CLOSE, days: org.work_days || DEFAULT_DAYS,
});
