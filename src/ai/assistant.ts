// AI features through the Kopor cloud function only: the business owner chooses the AI providers and models on the
// server (supabase/functions/_shared/llm.ts) and keys never reach phones. Users cannot change them.
import { z } from 'zod';
import { getSupabase } from '@/cloud/supabase';
import { formatMoney } from '@/lib/money';
import { today, addDays } from '@/lib/dates';
import type { Book } from '@/domain/book';
import { summary, topProducts, EXPENSE_CATEGORIES } from '@/domain/cash';
import { balances, overdueContacts, creditTotals } from '@/domain/credit';
import { stockLevels, forecast } from '@/domain/stock';
import { health } from '@/domain/health';
import { currentRound, roundStatus } from '@/domain/groups';
import type { Parsed } from './parser';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string | { type: string; text?: string; image_url?: { url: string } }[] };

async function complete(messages: Msg[], opts: { vision?: boolean; json?: boolean } = {}): Promise<string> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noAi');
  const { data, error } = await sb.functions.invoke('ai', { body: { messages, vision: !!opts.vision } });
  if (error || data?.error) throw new Error(data?.error ?? error?.message);
  return data.content as string;
}
export async function aiAvailable() { return !!(await getSupabase()); }
const extractJson = (s: string) => { const m = s.match(/\{[\s\S]*\}/); if (!m) throw new Error('AI gave no JSON'); return JSON.parse(m[0]); };

const ParsedSchema = z.object({
  action: z.enum(['sale', 'expense', 'credit_given', 'payment_received', 'unknown']).catch('unknown'),
  amount: z.coerce.number().nonnegative().catch(0),
  name: z.string().catch(''), item: z.string().catch(''), qty: z.coerce.number().positive().catch(1),
  method: z.enum(['cash', 'orange', 'afrimoney', 'qmoney', 'bank', 'credit']).catch('cash'),
  category: z.string().catch('other'), note: z.string().catch(''),
});

/** Structured record from free text (English/Krio). Amount returned in minor units. */
export async function aiParse(text: string, book: Book): Promise<Parsed> {
  const sys = `You turn a shopkeeper's message (English or Sierra Leone Krio) into ONE bookkeeping record.
Reply ONLY with JSON: {"action":"sale|expense|credit_given|payment_received|unknown","amount":number,"name":string,"item":string,"qty":number,"method":"cash|orange|afrimoney|qmoney|bank|credit","category":string,"note":string}
- amount = total money in major units (Leones). sale bought on credit => method "credit" and name = buyer.
- credit_given: someone took goods/money and owes. payment_received: someone paid a debt.
- expense category one of: ${EXPENSE_CATEGORIES.join(', ')}.
- Krio (standard spelling, often typed without ɛ/ɔ): "dɔn pe"/"don pay"=has paid, "pe bak"=paid back, "tek"=took, "sɛl"/"sel"=sold, "bay"=bought,
  "spɛn"=spent, "trɔs"/"trust"=credit, "ɔw"=owes, "dɛt"=debt, "lɛnt"=lent, "kopor"/"mɔni"=money, "tide"=today, "yɛstade"=yesterday,
  numbers: wan, tu, tri, fo, fayv, siks, sɛvin, et, nayn, tɛn, ɔndrɛd=hundred, tawzin=thousand (e.g. "tri tawzin"=3000).
Known customers: ${book.contacts.slice(0, 80).map((c) => c.name).join(', ') || 'none'}.
Known products: ${book.products.slice(0, 80).map((p) => p.name).join(', ') || 'none'}.`;
  const out = ParsedSchema.parse(extractJson(await complete([{ role: 'system', content: sys }, { role: 'user', content: text }], { json: true })));
  return { ...out, amount: Math.round(out.amount * 100) };
}

/** Compact, privacy-conscious snapshot of the books for the assistant (no phone numbers). */
export function bookContext(book: Book, now = today()) {
  const m = (x: number) => formatMoney(x);
  const s7 = summary(book, addDays(now, -6), now), s30 = summary(book, addDays(now, -29), now), sp30 = summary(book, addDays(now, -59), addDays(now, -30));
  const bal = balances(book.ledger);
  const debtors = book.contacts.map((c) => ({ n: c.name, b: bal.get(c.id) ?? 0 })).filter((x) => x.b > 0).sort((a, b) => b.b - a.b).slice(0, 10);
  const levels = stockLevels(book);
  const ct = creditTotals(book), h = health(book, now);
  return [
    `Business: ${book.org.name} (${book.org.type}). Today: ${now}. Currency: ${book.org.currency}.`,
    `Last 7 days: sales ${m(s7.sales)}, expenses ${m(s7.expenses)}, profit ${m(s7.profit)}.`,
    `Last 30 days: sales ${m(s30.sales)}, expenses ${m(s30.expenses)}, profit ${m(s30.profit)}. Previous 30 days sales ${m(sp30.sales)}.`,
    `Sales by payment method (30d): ${Object.entries(s30.byMethod).map(([k, v]) => `${k} ${m(v)}`).join(', ') || 'none'}.`,
    `Customers owe ${m(ct.get)}; business owes ${m(ct.give)}. Top debtors: ${debtors.map((d) => `${d.n} ${m(d.b)}`).join('; ') || 'none'}.`,
    `Overdue: ${overdueContacts(book, now).map((o) => `${o.contact.name} ${m(o.balance)} since ${o.since}`).join('; ') || 'none'}.`,
    `Top products (30d): ${topProducts(book, addDays(now, -29), now, 8).map((p) => `${p.name} x${p.qty} = ${m(p.amount)}`).join('; ') || 'none'}.`,
    `Stock: ${book.products.slice(0, 40).map((p) => { const f = forecast(book, p.id, 14, now); return `${p.name}: ${levels.get(p.id) ?? 0} ${p.unit}${f.daysLeft !== null ? ` (~${f.daysLeft} days left)` : ''}, price ${m(p.price)}, cost ${m(p.cost)}`; }).join('; ')}.`,
    `Groups: ${book.groups.map((g) => { const r = currentRound(g, now); const st = roundStatus(book, g, r); return `${g.name} (${g.kind}) round ${r}, ${st.unpaid.length} unpaid`; }).join('; ') || 'none'}.`,
    `Health score ${h.score}/100 (${h.label}).`,
  ].join('\n');
}

export async function askAssistant(question: string, history: { role: 'user' | 'assistant'; content: string }[], book: Book, lang: string): Promise<string> {
  const language = lang === 'kri' ? 'Sierra Leone Krio' : lang === 'fr' ? 'French' : 'simple English';
  const sys = `You are Kopor, a friendly, practical business advisor for small businesses in Sierra Leone and Africa.
Answer in ${language}, short and concrete (max ~120 words), using the business data below. Use exact numbers from the data.
Give practical advice (collect debts, restock, cut costs, pricing). Never invent numbers not in the data. If asked for something outside the data, say so.
DATA:
${bookContext(book)}`;
  return complete([{ role: 'system', content: sys }, ...history.slice(-8), { role: 'user', content: question }]);
}

const ScanSchema = z.object({
  kind: z.enum(['expense', 'sale']).catch('expense'),
  vendor: z.string().catch(''),
  date: z.string().catch(''),
  items: z.array(z.object({ name: z.string(), qty: z.coerce.number().catch(1), price: z.coerce.number().catch(0) })).catch([]),
  total: z.coerce.number().catch(0),
  category: z.string().catch('other'),
});
export type ScanResult = z.infer<typeof ScanSchema>;

/** Read a photographed receipt or handwritten notebook page. Prices returned in minor units. */
export async function scanReceipt(dataUrl: string): Promise<ScanResult> {
  const sys = `Read this receipt or handwritten sales/expense note. Reply ONLY with JSON:
{"kind":"expense|sale","vendor":string,"date":"YYYY-MM-DD or empty","items":[{"name":string,"qty":number,"price":number}],"total":number,"category":one of ${EXPENSE_CATEGORIES.join('|')}}
price = unit price in major currency units. If unsure of a field, leave it empty.`;
  const out = ScanSchema.parse(extractJson(await complete([
    { role: 'system', content: sys },
    { role: 'user', content: [{ type: 'text', text: 'Extract the data.' }, { type: 'image_url', image_url: { url: dataUrl } }] },
  ], { vision: true, json: true })));
  return { ...out, total: Math.round(out.total * 100), items: out.items.map((i) => ({ ...i, price: Math.round(i.price * 100) })) };
}
