// Offline natural-language entry parser (English + Krio). Turns "Aminata tek 2 tin oil 400 on credit"
// into a structured record. The AI model improves on this when online; this always works.
import { parseMoney } from '@/lib/money';

export type ParsedAction = 'sale' | 'expense' | 'credit_given' | 'payment_received' | 'unknown';
export interface Parsed {
  action: ParsedAction; amount: number; name: string; item: string; qty: number;
  method: 'cash' | 'orange' | 'afrimoney' | 'qmoney' | 'bank' | 'credit'; category: string; note: string;
}

const STOP = new Set(['i', 'me', 'mi', 'sold', 'sell', 'sel', 'spent', 'paid', 'pay', 'bought', 'buy', 'the', 'a', 'today', 'yesterday', 'customer', 'don', 'dem', 'we', 'a']);

const CATEGORY_WORDS: [string, RegExp][] = [
  ['transport', /transport|okada|keke|taxi|poda|bus|bike/], ['rent', /rent|shop rent/], ['fuel', /fuel|petrol|diesel|gas/],
  ['salaries', /salary|wages|staff|pay worker/], ['utilities', /light|electric|edsa|water|bill/], ['phone', /data|airtime|top ?up/],
  ['food', /food|lunch|chop|breakfast/], ['repairs', /repair|fix/], ['taxes', /tax|nra|council|licen[cs]e/], ['stock', /stock|goods|restock|bought|buy|wholesale/],
];

export function parseLocal(text: string, known: { contacts: string[]; products: string[] }): Parsed {
  const raw = text.trim();
  const t = ` ${raw.toLowerCase().replace(/[!?]/g, ' ').replace(/(\d),(\d{3})/g, '$1$2')} `;

  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million)?(?![\w])/g)].map((m) => ({
    v: parseFloat(m[1]) * (m[2]?.startsWith('k') || m[2] === 'thousand' ? 1000 : m[2]?.startsWith('m') ? 1e6 : 1),
  }));
  const amountMajor = nums.length ? Math.max(...nums.map((n) => n.v)) : 0;
  const qtyNum = nums.length > 1 ? nums.find((n) => n.v !== amountMajor) : undefined;

  let action: ParsedAction = 'unknown';
  if (/(paid me|pay me|don pay|has paid|have paid|repaid|paid back|pay back|received from|collected from|settled|pay mi)/.test(t)) action = 'payment_received';
  else if (/(sold|sell|sale|selling| sel )/.test(t)) action = 'sale';
  else if (/(owe|owes|on credit|trust|took|take|tek|credit|borrow|lend)/.test(t)) action = 'credit_given';
  else if (/(spent|spend|expense|bought|buy|paid for|pay for|transport|rent|fuel|salary|bill)/.test(t)) action = 'expense';
  else if (amountMajor) action = 'sale';

  const method = /orange/.test(t) ? 'orange' : /afri/.test(t) ? 'afrimoney' : /q ?money|qcell/.test(t) ? 'qmoney' : /bank|transfer/.test(t) ? 'bank'
    : /(credit|trust|owe)/.test(t) ? 'credit' : 'cash';

  let name = known.contacts.find((c) => t.includes(' ' + c.toLowerCase().split(' ')[0] + ' ')) ?? '';
  if (!name) {
    const m = raw.match(/\b(?:to|from|for|by|gi|give)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || raw.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s/);
    if (m && !STOP.has(m[1].toLowerCase())) name = m[1];
  }

  const product = [...known.products].sort((a, b) => b.length - a.length)
    .find((p) => t.includes(p.toLowerCase()) || p.toLowerCase().split(/\s+/).some((w) => w.length > 3 && t.includes(' ' + w)));
  const category = CATEGORY_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'other';

  return {
    action, amount: parseMoney(amountMajor), name, item: product ?? '', qty: product && qtyNum ? qtyNum.v : 1,
    method: action === 'sale' ? method : 'cash', category, note: '',
  };
}
