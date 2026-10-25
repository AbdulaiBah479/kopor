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
import { parseLocal, type Parsed } from './parser';
import { expiring, supplierDebts } from '@/domain/expiry';
import { seasonPlan } from '@/domain/seasons';
import { gstMonth } from '@/domain/gst';
import { monthCounts, monthOf, payFor, staffOf } from '@/domain/staff';
import { byPerson, watchFlags } from '@/domain/watch';

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
  action: z.enum(['sale', 'purchase', 'expense', 'credit_given', 'payment_received', 'unknown']).catch('unknown'),
  amount: z.coerce.number().nonnegative().catch(0),
  name: z.string().catch(''), item: z.string().catch(''), qty: z.coerce.number().positive().catch(1),
  method: z.enum(['cash', 'orange', 'afrimoney', 'qmoney', 'bank', 'credit']).catch('cash'),
  category: z.string().catch('other'), note: z.string().catch(''),
});

/**
 * Speech-to-text often mishears names, products and Krio words, and sometimes skips words. Fix the transcript using
 * the business's own customer and product names and, when available, a second listener's version of the same
 * recording (alt): keep every detail either version heard, never add anything. Falls back to the original text.
 */
export async function fixTranscript(text: string, book: Book, timeoutMs = 7000, alt = '', krio = ''): Promise<string> {
  const names = book.contacts.slice(0, 60).map((c) => c.name).join(', ') || 'none';
  const items = book.products.slice(0, 60).map((p) => p.name).join(', ') || 'none';
  const sys = `You fix speech-to-text slips in ONE short shop record (Sierra Leone English or Krio). Make the SMALLEST possible change.
- Only correct a word that is clearly a misheard customer or product name from the lists below, or a number written oddly
  ("to thousand" -> 2000, "tri hundred" -> 300, "liones" -> Leones).
- Keep every other word exactly as it is, in the same language. Never translate, summarise, add or remove information.
- If nothing is clearly wrong, return the sentence unchanged.${alt ? `
- A second listener wrote down the SAME recording (Version 2). Where Version 1 missed or garbled words, quantities or
  amounts that Version 2 heard, use what Version 2 heard. Only use words found in one of the two versions.` : ''}${krio ? `
- Version 3 comes from a listener trained on Krio. It writes Krio by sound, all lower case, and numbers often in words.
  Use it to settle Krio words, names and numbers the other versions disagree on or missed.` : ''}
Reply with the sentence only.
Customers: ${names}
Products: ${items}`;
  try {
    const out = await Promise.race([
      complete([{ role: 'system', content: sys }, { role: 'user', content: alt || krio ? [`Version 1: ${text}`, alt && `Version 2: ${alt}`, krio && `Version 3: ${krio}`].filter(Boolean).join('\n') : text }], { json: true }),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    const fixed = out.trim().replace(/^["'`]+|["'`]+$/g, '').split('\n')[0].trim();
    return keepsMeaning(text, fixed, book, alt, krio) ? fixed : text;
  } catch { return text; }
}

/**
 * Accept the AI's correction only if it is the same record: same amount (or an amount where the original had a number
 * in words), roughly the same length, and mostly the same words. Otherwise the original is kept.
 */
// Digits or number words (English, Krio, French): an amount may only be written down if something like this was said.
const SAID_NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|wan|tu|to|tri|fo|fayv|siks|sevin|et|nayn|tɛn|ɔndrɛd|ondred|tawzin|deux|trois|quatre|cinq|sept|huit|neuf|dix|cent|mille)\b/i;

export function keepsMeaning(original: string, fixed: string, book: Pick<Book, 'contacts' | 'products'>, alt = '', krio = ''): boolean {
  if (!fixed || fixed === original) return !!fixed;
  const known = { contacts: book.contacts.map((c) => c.name), products: book.products.map((p) => p.name) };
  const a = parseLocal(original, known), b = parseLocal(fixed, known), c = alt ? parseLocal(alt, known) : null;
  const k = krio ? parseLocal(krio, known) : null;
  // Never invent an amount: it must be one a listener heard (when any amount was heard at all).
  const heard = [a.amount, c?.amount ?? 0, k?.amount ?? 0].filter((x) => x > 0);
  if (heard.length && !heard.includes(b.amount)) return false;
  if (!heard.length && b.amount > 0 && !SAID_NUMBER.test(`${original} ${alt} ${krio}`)) return false;   // no number was said at all
  if (a.action !== 'unknown' && b.action !== 'unknown' && a.action !== b.action && c?.action !== b.action) return false;
  const words = (s: string): string[] => s.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? [];
  const wa = words(original), wc = words(alt), wb = words(fixed);
  const longest = Math.max(wa.length, wc.length), shortest = wc.length ? Math.min(wa.length, wc.length) : wa.length;
  if (wb.length < shortest * 0.6 || wb.length > longest * 1.5 + 2) return false;
  const pool = new Set([...wa, ...wc, ...words(krio)]);
  const shared = wb.filter((w) => pool.has(w)).length;
  return shared >= Math.min(longest, wb.length) * 0.5;               // mostly words that were really heard
}
/** Structured record from free text (English/Krio). Amount returned in minor units. */
export async function aiParse(text: string, book: Book): Promise<Parsed> {
  const sys = `You turn a shopkeeper's message (English or Sierra Leone Krio) into ONE bookkeeping record.
Reply ONLY with JSON: {"action":"sale|purchase|expense|credit_given|payment_received|unknown","amount":number,"name":string,"item":string,"qty":number,"method":"cash|orange|afrimoney|qmoney|bank|credit","category":string,"note":string}
- amount = total money in major units (Leones). sale bought on credit => method "credit" and name = buyer.
- credit_given: someone took goods/money and owes. payment_received: someone paid a debt.
- purchase: the shop BOUGHT goods to sell again (restock), e.g. "bought 5 bags rice 3500", "a bay 5 bag res" (item = the goods, qty, amount = total paid).
  expense: other costs (transport, rent, food, airtime...).
- expense category one of: ${EXPENSE_CATEGORIES.join(', ')}.
- Krio (standard spelling, often typed without ɛ/ɔ): "dɔn pe"/"don pay"=has paid, "pe bak"=paid back, "tek"=took, "sɛl"/"sel"=sold, "bay"=bought,
  "spɛn"=spent, "trɔs"/"trust"=credit, "ɔw"=owes, "dɛt"=debt, "lɛnt"=lent, "kopor"/"mɔni"=money, "tide"=today, "yɛstade"=yesterday,
  numbers: wan, tu, tri, fo, fayv, siks, sɛvin, et, nayn, tɛn, ɔndrɛd=hundred, tawzin=thousand (e.g. "tri tawzin"=3000).
Known customers: ${book.contacts.slice(0, 80).map((c) => c.name).join(', ') || 'none'}.
Known products: ${book.products.slice(0, 80).map((p) => p.name).join(', ') || 'none'}.`;
  const out = ParsedSchema.parse(extractJson(await complete([{ role: 'system', content: sys }, { role: 'user', content: text }], { json: true })));
  return { ...out, amount: Math.round(out.amount * 100) };
}

/**
 * Compact, privacy-conscious snapshot of the books for the assistant (no phone numbers). `private` (owners and
 * managers) adds staff attendance and pay, and Fraud watch's warning signs; cashiers never get those.
 */
export function bookContext(book: Book, now = today(), opts: { private?: boolean } = {}) {
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
    `Expiring within 30 days: ${expiring(book, 30, now).slice(0, 10).map((x) => `${x.product.name} ${x.qty} ${x.product.unit} ${x.expired ? 'EXPIRED' : 'on'} ${x.expiry}`).join('; ') || 'none'}.`,
    `Coming big dates (from last year's sales): ${seasonPlan(book, now).slice(0, 6).map((x) => `${x.event.key} in ${x.days} days: ${x.product.name} sold ${x.times}x more last year; need ~${x.need}, have ${x.have}`).join('; ') || 'none'}.`,
    `Suppliers the business owes: ${supplierDebts(book).slice(0, 8).map((x) => `${x.contact.name} ${m(x.owed)}`).join('; ') || 'none'}.`,
    ...(book.org.tax_rate ? [(() => { const g = gstMonth(book, monthOf(now)); return `GST this month so far (${g.rate}%): charged ${m(g.outputTax)} on sales of ${m(g.taxableSales)}; to pay ~${m(g.net)} before input tax.`; })()] : []),
    ...(opts.private ? privateContext(book, now) : []),
  ].join('\n');
}

/** Owners and managers only: staff this month and the warning signs from Fraud watch. */
function privateContext(book: Book, now: string): string[] {
  const m = (x: number) => formatMoney(x);
  const month = monthOf(now);
  const staff = staffOf(book).map((s) => {
    const c = monthCounts(book, s.id, month);
    const p = book.staffTerms.length ? payFor(book, s.id, month) : null;
    return `${s.name} (${s.role}): here ${c.present + c.late} (late ${c.late}), absent ${c.absent}${p?.terms ? `, still owed ${m(p.balance)} of ${m(p.due)}` : ''}`;
  });
  const flags = watchFlags(book, [], 30, now);
  const people = byPerson(flags).slice(0, 6).map((p) => `${p.who}: ${Object.entries(p.kinds).map(([k, n]) => `${k} x${n}`).join(', ')} (${m(p.amount)})`);
  const unconfirmed = flags.filter((f) => f.kind === 'unconfirmed');
  return [
    `Staff this month: ${staff.join('; ') || 'none'}.`,
    `Fraud watch, last 30 days (warning signs, not proof): ${people.join('; ') || 'none'}. Mobile money sales not confirmed by Monime: ${unconfirmed.length} (${m(unconfirmed.reduce((s, f) => s + f.amount, 0))}).`,
  ];
}

export async function askAssistant(question: string, history: { role: 'user' | 'assistant'; content: string }[], book: Book, lang: string, opts: { private?: boolean } = {}): Promise<string> {
  const language = lang === 'kri' ? 'Sierra Leone Krio' : lang === 'fr' ? 'French' : 'simple English';
  const sys = `You are Kopor, a friendly, practical business advisor for small businesses in Sierra Leone and Africa.
Answer in ${language}, short and concrete (max ~120 words), using the business data below. Use exact numbers from the data.
Give practical advice (collect debts, restock, cut costs, pricing, expiring stock, staff, theft). Never invent numbers not in the data. If asked for something outside the data, say so.
Warning signs about staff are not proof: suggest checking the records and talking to the person, never accuse.
DATA:
${bookContext(book, today(), opts)}`;
  return complete([{ role: 'system', content: sys }, ...history.slice(-8), { role: 'user', content: question }]);
}

const ScanSchema = z.object({
  // purchase = goods bought for the shop (a supplier's receipt); sale = goods sold (sales note); expense = other costs.
  kind: z.enum(['purchase', 'sale', 'expense']).catch('expense'),
  vendor: z.string().catch(''),
  date: z.string().catch(''),
  items: z.array(z.object({ name: z.string(), qty: z.coerce.number().catch(1), price: z.coerce.number().catch(0) })).catch([]),
  total: z.coerce.number().catch(0),
  category: z.string().catch('other'),
});
export type ScanResult = z.infer<typeof ScanSchema>;

const ItemSchema = z.object({
  name: z.string().catch(''), brand: z.string().catch(''), size: z.string().catch(''),
  barcode: z.string().catch(''), match: z.string().catch(''), confidence: z.coerce.number().min(0).max(1).catch(0),
});
export type ItemGuess = z.infer<typeof ItemSchema>;

/**
 * What product is in this photo (a tin, bag, packet, bottle…)? `match` is one of the shop's own product names when it
 * is clearly the same product, otherwise empty (a new product).
 */
export async function identifyItem(dataUrl: string, products: string[] = []): Promise<ItemGuess> {
  const sys = `You identify ONE product for sale in a small shop in Sierra Leone from a photo (packaging, label, bag, tin, bottle...).
Reply ONLY with JSON: {"name":string,"brand":string,"size":string,"barcode":string,"match":string,"confidence":number}
- name: a short shop name for it, e.g. "Peak Milk tin 400g", "Rice 50kg bag", "Coca-Cola 35cl".
- barcode: the digits under the barcode if you can read them clearly, else "".
- match: if it is clearly the same product as one in this list, copy that name EXACTLY; otherwise "". Same brand but a different
  size or flavour is NOT a match. List: ${products.slice(0, 150).join(' | ') || 'none'}
- confidence: 0 to 1, how sure you are. Never guess wildly: if you cannot tell, give a low confidence.`;
  return ItemSchema.parse(extractJson(await complete([
    { role: 'system', content: sys },
    { role: 'user', content: [{ type: 'text', text: 'What product is this?' }, { type: 'image_url', image_url: { url: dataUrl } }] },
  ], { vision: true, json: true })));
}

/**
 * Read a photographed receipt, invoice or handwritten notebook page (no barcode needed). Prices in minor units.
 * Known product names are given so items come back spelt the way the shop already writes them.
 */
export async function scanReceipt(dataUrl: string, products: string[] = []): Promise<ScanResult> {
  const sys = `You read a photo of a receipt, supplier invoice or handwritten note from a small shop in Sierra Leone. Reply ONLY with JSON:
{"kind":"purchase|sale|expense","vendor":string,"date":"YYYY-MM-DD or empty","items":[{"name":string,"qty":number,"price":number}],"total":number,"category":one of ${EXPENSE_CATEGORIES.join('|')}}
- kind: "purchase" = goods the shop BOUGHT to resell (supplier receipt, wholesaler bill); "sale" = goods the shop SOLD (sales book, list of
  customers' purchases); "expense" = other costs (transport, rent, electricity, airtime, food...).
- One item per line of goods. qty = how many; price = price of ONE unit in Leones (if only a line total is written, divide it by qty).
- Read handwriting carefully; numbers may be written like 1,500 or 1.500 or 1500 (all mean one thousand five hundred).
- Do not list tax, discount, change or total lines as items. total = the amount actually paid.
- If an item is one of these known products, use exactly this name: ${products.slice(0, 120).join(', ') || 'none'}.
- If you cannot read a field, leave it empty or 0. Never invent items.`;
  const out = ScanSchema.parse(extractJson(await complete([
    { role: 'system', content: sys },
    { role: 'user', content: [{ type: 'text', text: 'Extract the data.' }, { type: 'image_url', image_url: { url: dataUrl } }] },
  ], { vision: true, json: true })));
  return { ...out, total: Math.round(out.total * 100), items: out.items.map((i) => ({ ...i, price: Math.round(i.price * 100) })) };
}
