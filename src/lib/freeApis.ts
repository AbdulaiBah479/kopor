// Free public services Kopor uses (no account or key needed; both allowed in the app's Content-Security-Policy):
//  - Open Food Facts (openfoodfacts.org, data under the Open Database License): the name of a packaged product from
//    its barcode, so scanning a new item fills in its name.
//  - The US dollar rate in Leones comes from Kopor's server (supabase/functions/rates: the Bank of Sierra Leone official
//    rate when its key is set, otherwise the average of two market sources), or straight from ExchangeRate-API's open
//    endpoint (open.er-api.com) when the server cannot be reached. Kept on the phone an hour; the last one offline.
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

export interface DollarRate { rate: number; date: string; kind: 'official' | 'market'; fresh: boolean }
const KEY = 'usdRate2', KEEP = 3_600_000; // a phone asks again after an hour

/** The server's rate (supabase/functions/rates): the Bank of Sierra Leone official rate, or the market average. */
async function fromServer(): Promise<Omit<DollarRate, 'fresh'> | null> {
  const { getAnonSupabase } = await import('@/cloud/supabase');
  const sb = await getAnonSupabase();
  if (!sb) return null;
  const { data, error } = await sb.functions.invoke('rates', { body: {} });
  if (error || !(Number(data?.rate) > 0)) return null;
  return { rate: Number(data.rate), date: String(data.date), kind: data.kind === 'official' ? 'official' : 'market' };
}

/** Straight from the open source, when the server cannot be reached. */
async function fromOpenSource(): Promise<Omit<DollarRate, 'fresh'> | null> {
  const j = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: timeout(8000) })).json();
  const rate = Number(j?.rates?.SLE);
  if (j?.result !== 'success' || !(rate > 0)) return null;
  return { rate, date: new Date((j.time_last_update_unix ?? 0) * 1000).toISOString().slice(0, 10), kind: 'market' };
}

/** Leones for one US dollar (new Leones, SLE): official when available, kept an hour, the last one when offline. */
export async function dollarRate(): Promise<DollarRate | null> {
  const saved = await getMeta<(Omit<DollarRate, 'fresh'> & { got: number }) | null>(KEY, null);
  if (saved && Date.now() - saved.got < KEEP) return { rate: saved.rate, date: saved.date, kind: saved.kind, fresh: true };
  try {
    const v = (await fromServer().catch(() => null)) ?? (await fromOpenSource());
    if (!v) throw new Error('no rate');
    await setMeta(KEY, { ...v, got: Date.now() });
    return { ...v, fresh: true };
  } catch {
    return saved ? { rate: saved.rate, date: saved.date, kind: saved.kind, fresh: false } : null;
  }
}
