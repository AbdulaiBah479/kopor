// Discounts and tax (e.g. Sierra Leone GST 15%). All amounts are integer minor units.
import type { Org } from '@/db/schema';

export interface Totals { subtotal: number; discount: number; tax: number; total: number }

export interface TaxSettings { rate: number; inclusive: boolean }
export const taxSettings = (org: Pick<Org, 'tax_rate' | 'tax_inclusive'>): TaxSettings =>
  ({ rate: Math.max(0, Number(org.tax_rate) || 0), inclusive: org.tax_inclusive === 1 });

/**
 * Exclusive tax: total = (subtotal − discount) × (1 + rate).
 * Inclusive tax: prices already contain tax, so total = subtotal − discount and the tax portion is extracted.
 */
export function computeTotals(subtotal: number, discount: number, tax: TaxSettings): Totals {
  const sub = Math.max(0, Math.round(subtotal));
  const disc = Math.min(sub, Math.max(0, Math.round(discount)));
  const base = sub - disc;
  const r = tax.rate / 100;
  if (!r) return { subtotal: sub, discount: disc, tax: 0, total: base };
  if (tax.inclusive) {
    const t = Math.round(base - base / (1 + r));
    return { subtotal: sub, discount: disc, tax: t, total: base };
  }
  const t = Math.round(base * r);
  return { subtotal: sub, discount: disc, tax: t, total: base + t };
}
