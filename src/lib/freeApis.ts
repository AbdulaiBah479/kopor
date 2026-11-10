// Free public services Kopor uses (no account or key needed; both allowed in the app's Content-Security-Policy):
//  - Open Food Facts (openfoodfacts.org, data under the Open Database License): the name of a packaged product from
//    its barcode, so scanning a new item fills in its name.
//  - ExchangeRate-API's open endpoint (open.er-api.com, updated daily): today's US dollar rate in Leones, for traders
//    who buy goods in dollars. Kept on the phone for 12 hours and shown from there when offline.
import { getMeta, setMeta } from '@/db/repo';

const timeout = (ms: number) => AbortSignal.timeout(ms);
const tidy = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "Indomie Mi Goreng Original 85 g", or null when the product is unknown or the phone is offline. */
export async function productName(barcode: string): Promise<string | null> {
  const code = barcode.replace(/\D/g, '');
  if (code.length < 8 || code.length > 14) return null;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity`, { signal: timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const name = tidy(j.product.product_name), brand = tidy(String(j.product.brands ?? '').split(',')[0]), qty = tidy(j.product.quantity);
    if (!name) return null;
    const full = [name.toLowerCase().includes(brand.toLowerCase()) ? '' : brand, name, qty].filter(Boolean).join(' ');
    return full.slice(0, 80);
  } catch { return null; }
}

export interface DollarRate { rate: number; at: string; fresh: boolean }
const KEY = 'usdRate', KEEP = 12 * 3_600_000;

/** Leones for one US dollar (new Leones, SLE). */
export async function dollarRate(): Promise<DollarRate | null> {
  const saved = await getMeta<{ rate: number; at: string; got: number } | null>(KEY, null);
  if (saved && Date.now() - saved.got < KEEP) return { rate: saved.rate, at: saved.at, fresh: true };
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: timeout(8000) });
    const j = await r.json();
    const rate = Number(j?.rates?.SLE);
    if (j?.result !== 'success' || !(rate > 0)) throw new Error('no rate');
    const v = { rate, at: String(j.time_last_update_utc ?? ''), got: Date.now() };
    await setMeta(KEY, v);
    return { rate, at: v.at, fresh: true };
  } catch {
    return saved ? { rate: saved.rate, at: saved.at, fresh: false } : null;
  }
}
