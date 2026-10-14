// Offline natural-language entry parser (English + Krio). Turns "Aminata tek 2 tin oil 400 on credit"
// into a structured record. The AI model improves on this when online; this always works.
// Krio words follow the standard spelling found in open English–Krio corpora (OPUS MT560 pairs, CC-BY-4.0;
// Jaward/Krio-Corpus, Apache-2.0), and also match the everyday phone spelling without ɛ/ɔ ("dɔn pe" = "don pe").
import { parseMoney } from '@/lib/money';

export type ParsedAction = 'sale' | 'expense' | 'credit_given' | 'payment_received' | 'unknown';
export interface Parsed {
  action: ParsedAction; amount: number; name: string; item: string; qty: number;
  method: 'cash' | 'orange' | 'afrimoney' | 'qmoney' | 'bank' | 'credit'; category: string; note: string;
}

/** Lowercase and fold Krio letters to plain ASCII so both spellings match the same patterns. */
export const foldKrio = (s: string) => s.toLowerCase().normalize('NFC').replace(/ɛ/g, 'e').replace(/ɔ/g, 'o').replace(/ŋ/g, 'ng');

const UNITS: Record<string, number> = {
  wan: 1, one: 1, tu: 2, two: 2, tri: 3, three: 3, four: 4, fayv: 5, five: 5, siks: 6, six: 6, sevin: 7, seven: 7,
  et: 8, eight: 8, nayn: 9, nine: 9, ten: 10, twelv: 12, twelve: 12, fifteen: 15, twenti: 20, twenty: 20,
  tati: 30, thirty: 30, foti: 40, forty: 40, fifti: 50, fifty: 50, hundred: 100,
};
const MULT: Record<string, number> = { ondred: 100, hundred: 100, tawzin: 1000, tauzin: 1000, thousand: 1000, milyon: 1e6, million: 1e6 };

/** "tri ondred" -> "300", "2 tawzin" -> "2000", "fo tawzin" -> "4000". ("fo" alone is Krio "for", so it only counts before a multiplier.) */
function wordsToDigits(t: string) {
  const toks = t.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    let total = 0, cur = 0, used = 0, j = i;
    for (; j < toks.length; j++) {
      const w = toks[j], next = toks[j + 1] ?? '';
      const unit = /^\d+(\.\d+)?$/.test(w) && MULT[next] ? parseFloat(w) : w === 'fo' && MULT[next] ? 4 : w === 'hundred' ? undefined : UNITS[w];
      if (unit !== undefined) { cur += unit; used++; continue; }
      if (MULT[w] && used) { cur = (cur || 1) * MULT[w]; if (MULT[w] >= 1000) { total += cur; cur = 0; } used++; continue; }
      if (w === 'en' || w === 'and') { if (used && (UNITS[next] !== undefined || /^\d/.test(next))) continue; }
      break;
    }
    // A lone number word ("wan bag") is a quantity; keep it as a digit too.
    if (used) { out.push(String(total + cur)); i = j - 1; } else out.push(toks[i]);
  }
  return out.join(' ');
}

const STOP = new Set(['i', 'me', 'mi', 'a', 'sold', 'sell', 'sel', 'spent', 'paid', 'pay', 'pe', 'bought', 'buy', 'bay', 'the', 'today', 'tide',
  'yesterday', 'yestade', 'customer', 'don', 'dem', 'den', 'we', 'tek', 'gi', 'mek']);

const CATEGORY_WORDS: [string, RegExp][] = [
  ['transport', /transport|transpot|okada|keke|taxi|poda|bus|bike|motoka/], ['rent', /\brent\b|shop rent/], ['fuel', /fuel|fyuel|petrol|diesel|gas/],
  ['salaries', /salary|wages|staff|pay worker|wok pe/], ['utilities', /light|layt|electric|edsa|water|wata|bill/], ['phone', /data|airtime|top ?up|kredit fo fon/],
  ['food', /food|lunch|chop|breakfast|chop/], ['repairs', /repair|fix/], ['taxes', /tax|taks|nra|council|licen[cs]e/],
  ['stock', /stock|stok|goods|restock|bought|\bbuy\b|\bbay\b|wholesale|hol sel/],
];

export function parseLocal(text: string, known: { contacts: string[]; products: string[] }): Parsed {
  const raw = text.trim();
  const folded = foldKrio(raw).replace(/[!?]/g, ' ').replace(/(\d),(\d{3})/g, '$1$2').replace(/\ble\s*(?=\d)/g, ' ');
  const t = ` ${wordsToDigits(folded.replace(/\s+/g, ' ').trim())} `;

  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k|m)?(?![\w])/g)].map((m) => ({
    v: parseFloat(m[1]) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1e6 : 1),
  }));
  const amountMajor = nums.length ? Math.max(...nums.map((n) => n.v)) : 0;
  const qtyNum = nums.length > 1 ? nums.find((n) => n.v !== amountMajor) : undefined;

  let action: ParsedAction = 'unknown';
  if (/(paid me|pay me|pe mi|pay mi|don pay|don pe|has paid|have paid|repaid|paid back|pay back|pe bak|received from|collected from|settled|kam pe|gi mi mi moni)/.test(t)) action = 'payment_received';
  else if (/(sold|\bsell|\bsale|selling| sel )/.test(t)) action = 'sale';
  else if (/(\bowe|\bow mi|on credit|pan tros|\btros\b|trust|took|\btake\b|\btek\b|credit|kredit|borrow|\blend|\blent\b)/.test(t)) action = 'credit_given';
  else if (/(spent|spend|\bspen\b|expense|ekspens|bought|\bbuy\b|\bbay\b|paid for|pay for|pe fo|transport|\brent\b|fuel|salary|bill)/.test(t)) action = 'expense';
  else if (amountMajor) action = 'sale';

  const method = /orange|orenj/.test(t) ? 'orange' : /afri/.test(t) ? 'afrimoney' : /q ?money|kyu ?moni|qcell/.test(t) ? 'qmoney' : /bank|transfer/.test(t) ? 'bank'
    : /(credit|kredit|trust|tros|owe)/.test(t) ? 'credit' : 'cash';

  let name = known.contacts.find((c) => t.includes(' ' + foldKrio(c).split(' ')[0] + ' ')) ?? '';
  if (!name) {
    const m = raw.match(/\b(?:to|from|for|by|gi|give|fɔ|frɔm)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || raw.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s/);
    if (m && !STOP.has(foldKrio(m[1]))) name = m[1];
  }

  const product = [...known.products].sort((a, b) => b.length - a.length)
    .find((p) => { const fp = foldKrio(p); return t.includes(fp) || fp.split(/\s+/).some((w) => w.length > 3 && t.includes(' ' + w)); });
  const category = CATEGORY_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'other';

  return {
    action, amount: parseMoney(amountMajor), name, item: product ?? '', qty: product && qtyNum ? qtyNum.v : 1,
    method: action === 'sale' ? method : 'cash', category, note: '',
  };
}
