// Business dates are local "YYYY-MM-DD" strings: they sort and compare as text.
export type ISODate = string;

export function isoDate(d: Date = new Date()): ISODate {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}
export const today = () => isoDate();
const at = (iso: ISODate) => new Date(`${iso}T12:00:00`);
export function addDays(iso: ISODate, n: number): ISODate { const d = at(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function addMonths(iso: ISODate, n: number): ISODate { const d = at(iso); d.setMonth(d.getMonth() + n); return isoDate(d); }
export const daysBetween = (a: ISODate, b: ISODate) => Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000);
export const monthStart = (iso: ISODate) => iso.slice(0, 8) + '01';

export function fmtDate(iso: ISODate | null | undefined, locale = 'en-GB'): string {
  if (!iso) return '';
  return at(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const fmtMonth = (iso: ISODate, locale = 'en-GB') => at(iso).toLocaleDateString(locale, { month: 'short', year: 'numeric' });
export const weekdayShort = (iso: ISODate, locale = 'en-GB') => at(iso).toLocaleDateString(locale, { weekday: 'short' });
