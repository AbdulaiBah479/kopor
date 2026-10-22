// Daily reminder notification inside the Android app (free, no server, works offline): the app works out what needs
// attention from the records on the phone and schedules a notification for 8:00 the next morning, plus a gentle
// "open Kopor" nudge for the following days in case the app is not opened. Browsers use Web Push instead (cloud/push).
import type { TFunction } from 'i18next';
import type { Book } from '@/domain/book';
import { overdueContacts } from '@/domain/credit';
import { lowStock } from '@/domain/stock';
import { loanReminders, pendingClaims } from '@/domain/groups';
import { getMeta, setMeta } from '@/db/repo';

export interface Digest { overdue: number; claims: number; loans: number; low: number }

/** What needs attention today (pure: unit tested). */
export function dailyDigest(book: Book, now?: string): Digest {
  return {
    overdue: overdueContacts(book, now).length,
    claims: pendingClaims(book).length,
    loans: loanReminders(book, 0, now).length,
    low: lowStock(book).length,
  };
}

/** One short line, e.g. "3 customers overdue · 1 payment to approve", or null when nothing needs attention. */
export function digestText(t: TFunction, d: Digest): string | null {
  const parts = [
    d.overdue && t('daily.overdue', { count: d.overdue }), d.claims && t('daily.claims', { count: d.claims }),
    d.loans && t('daily.loans', { count: d.loans }), d.low && t('daily.low', { count: d.low }),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The next 8:00 in the phone's time zone (today if it is still before 8:00). */
export function nextMorning(from = new Date(), hour = 8): Date {
  const d = new Date(from);
  d.setHours(hour, 0, 0, 0);
  if (d <= from) d.setDate(d.getDate() + 1);
  return d;
}

const isNative = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
export const localRemindersSupported = isNative;
const IDS = [7001, 7002, 7003, 7004, 7005, 7006, 7007];

export const dailyReminderOn = () => getMeta<boolean>('dailyReminder', false);

/** Ask permission and turn the daily reminder on (Android app only). Returns false if the person said no. */
export async function enableDailyReminder(): Promise<boolean> {
  if (!isNative()) return false;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const p = await LocalNotifications.requestPermissions();
  const ok = p.display === 'granted';
  await setMeta('dailyReminder', ok);
  return ok;
}

export async function disableDailyReminder() {
  await setMeta('dailyReminder', false);
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.cancel({ notifications: IDS.map((id) => ({ id })) });
}

/** (Re)schedule from the current records. Called when the app opens and after changes. Silent if off or not the app. */
export async function scheduleDailyReminder(book: Book, t: TFunction) {
  if (!isNative() || !(await dailyReminderOn())) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  await LocalNotifications.cancel({ notifications: IDS.map((id) => ({ id })) });
  const body = digestText(t, dailyDigest(book));
  if (!body) return;
  const first = nextMorning();
  await LocalNotifications.schedule({
    notifications: IDS.map((id, i) => {
      const at = new Date(first); at.setDate(at.getDate() + i);
      return {
        id, title: t('daily.title', { name: book.org.name }), body: i === 0 ? body : t('daily.nudge'),
        schedule: { at, allowWhileIdle: true }, extra: { url: '#/reminders' },
      };
    }),
  });
}
