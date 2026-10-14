// Money is stored as integer minor units (cents) to avoid floating-point errors.
export type Minor = number;

let CURRENCY = 'Le';
export const setCurrencySymbol = (c: string) => { CURRENCY = c || 'Le'; };
export const currencySymbol = () => CURRENCY;

/** Parse user input like "1,200.50", "5k", "2.5m" into minor units. */
export function parseMoney(input: unknown): Minor {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : 0;
  let s = String(input ?? '').trim().toLowerCase().replace(/[,\s]/g, '').replace(/^(le|sle|nle)/, '');
  let mult = 1;
  if (s.endsWith('k')) { mult = 1_000; s = s.slice(0, -1); }
  else if (s.endsWith('m')) { mult = 1_000_000; s = s.slice(0, -1); }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * mult * 100) : 0;
}

/** Major-unit number for inputs (e.g. 120050 -> 1200.5). */
export const toMajor = (m: Minor) => m / 100;

export function formatMoney(m: Minor, opts: { sign?: boolean; symbol?: boolean } = {}): string {
  const v = Math.round(m);
  const abs = Math.abs(v) / 100;
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const pre = v < 0 ? '-' : opts.sign && v > 0 ? '+' : '';
  return `${pre}${opts.symbol === false ? '' : CURRENCY + ' '}${body}`;
}

export function formatShort(m: Minor): string {
  const v = Math.abs(m) / 100;
  const s = v >= 1e6 ? `${trim(v / 1e6)}m` : v >= 1e3 ? `${trim(v / 1e3)}k` : String(Math.round(v));
  return (m < 0 ? '-' : '') + s;
}
const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');

export const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0);
