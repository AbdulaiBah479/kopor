// Today's US dollar rate in Leones, for every phone (migration 0050).
//   POST {} -> { rate, date, kind: 'official' | 'market', sources: [{ source, rate, date }], at }
// Sources, best first:
//   - Bank of Sierra Leone official mid rate, through AllRatesToday (free key in the ALLRATES_API_KEY secret; BSL
//     publishes once per business day);
//   - otherwise the market rate: the average of two independent daily sources (ExchangeRate-API open endpoint and
//     the open currency-api), so one wrong figure stands out.
// Each source is asked at most once an hour (the official one every 3 hours); the answers are kept in fx_rates.
import { admin, cors, json } from '../_shared/util.ts';

type Row = { source: string; rate: number; rate_date: string; fetched_at: string };
const HOUR = 3_600_000;
const timeout = (ms: number) => AbortSignal.timeout(ms);
const plausible = (r: number) => r > 5 && r < 100; // SLE per USD has been about 20-25 since the 2022 redenomination

const SOURCES: Record<string, { every: number; get: () => Promise<{ rate: number; date: string } | null> }> = {
  bsl: {
    every: 3 * HOUR,
    async get() {
      const key = Deno.env.get('ALLRATES_API_KEY');
      if (!key) return null;
      const r = await fetch('https://allratestoday.com/api/v1/central-bank/bsl/latest', { headers: { Authorization: `Bearer ${key}` }, signal: timeout(10_000) });
      if (!r.ok) return null;
      const j = await r.json();
      // The table lists foreign currencies against the leone; find the US dollar row whatever the exact shape.
      const rows: Record<string, unknown>[] = Array.isArray(j?.rates) ? j.rates : Array.isArray(j?.data?.rates) ? j.data.rates : Array.isArray(j?.data) ? j.data : [];
      const usd = rows.find((x) => String(x.currency ?? x.code ?? x.base ?? '').toUpperCase() === 'USD');
      const rate = Number(usd?.rate ?? usd?.mid ?? usd?.value ?? j?.rates?.USD);
      const date = String(j?.rate_date ?? j?.date ?? j?.data?.rate_date ?? usd?.rate_date ?? '').slice(0, 10);
      return plausible(rate) && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { rate, date } : null;
    },
  },
  erapi: {
    every: HOUR,
    async get() {
      const j = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: timeout(10_000) })).json();
      const rate = Number(j?.rates?.SLE);
      const date = j?.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : '';
      return j?.result === 'success' && plausible(rate) && date ? { rate, date } : null;
    },
  },
  currencyapi: {
    every: HOUR,
    async get() {
      const j = await (await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', { signal: timeout(10_000) })).json();
      const rate = Number(j?.usd?.sle);
      const date = String(j?.date ?? '');
      return plausible(rate) && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { rate, date } : null;
    },
  },
};

async function current(): Promise<Row[]> {
  const db = admin();
  const { data } = await db.from('fx_rates').select('*');
  const rows = new Map((data ?? []).map((r: Row) => [r.source, r]));
  await Promise.all(Object.entries(SOURCES).map(async ([source, s]) => {
    const old = rows.get(source);
    if (old && Date.now() - Date.parse(old.fetched_at) < s.every) return;
    const got = await s.get().catch(() => null);
    if (!got) return; // keep the last good figure
    const row = { source, rate: got.rate, rate_date: got.date, fetched_at: new Date().toISOString() };
    rows.set(source, row);
    await db.from('fx_rates').upsert(row);
  }));
  return [...rows.values()];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const rows = await current();
    const at = new Date().toISOString();
    const sources = rows.map((r) => ({ source: r.source, rate: Number(r.rate), date: r.rate_date }));
    const official = rows.find((r) => r.source === 'bsl');
    // The official rate counts while it is less than 5 days old (it is not published at weekends and on holidays).
    if (official && Date.now() - Date.parse(official.rate_date) < 5 * 86_400_000) {
      return json({ rate: Number(official.rate), date: official.rate_date, kind: 'official', sources, at });
    }
    const market = rows.filter((r) => r.source !== 'bsl' && Date.now() - Date.parse(r.rate_date) < 4 * 86_400_000);
    if (!market.length) return json({ error: 'No current rate' }, 503);
    const rate = market.reduce((s, r) => s + Number(r.rate), 0) / market.length;
    const date = market.map((r) => r.rate_date).sort().at(-1)!;
    return json({ rate: Math.round(rate * 10_000) / 10_000, date, kind: 'market', sources, at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, 500);
  }
});
