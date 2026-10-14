// App state, business rules and metrics. Views read S synchronously;
// every write goes through save()/remove() so IndexedDB and memory stay in step.
import { db, STORES } from './db.js';
import { uid, today, addDays, addMonths, num, round2, refCode } from './util.js';

const DATA = STORES.filter((s) => s !== 'settings');
export const DEFAULTS = {
  id: 'main', onboarded: false, business: '', owner: '', phone: '', type: 'Shop', address: '',
  currency: 'Le', cc: '232', momo: '', theme: 'auto', invSeq: 0, pinHash: '',
  aiBase: 'https://api.groq.com/openai/v1', aiModel: 'llama-3.3-70b-versatile', aiKey: '',
};

export const S = { settings: { ...DEFAULTS } };
DATA.forEach((k) => { S[k] = []; });

export async function load() {
  await Promise.all(DATA.map(async (k) => { S[k] = await db.all(k); }));
  S.settings = { ...DEFAULTS, ...((await db.get('settings', 'main')) || {}) };
}

export async function save(store, obj) {
  obj.id ||= uid();
  obj.createdAt ||= Date.now();
  obj.updatedAt = Date.now();
  await db.put(store, obj);
  const arr = S[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  return obj;
}

export async function remove(store, id) {
  await db.del(store, id);
  S[store] = S[store].filter((x) => x.id !== id);
}

export async function saveSettings(patch) {
  S.settings = { ...S.settings, ...patch, id: 'main' };
  await db.put('settings', S.settings);
}

export function exportData() {
  const out = { app: 'kopor', version: 1, exportedAt: new Date().toISOString(), settings: [S.settings] };
  DATA.forEach((k) => { out[k] = S[k]; });
  return out;
}
export async function importData(data) {
  if (!data || data.app !== 'kopor') throw new Error('This is not a Kopor backup file');
  await db.replaceAll(data);
  await load();
}
export async function resetAll() {
  await db.replaceAll({});
  await load();
}

/* ---------- Contacts & credit book ---------- */
export const byId = (store, id) => S[store].find((x) => x.id === id);
const norm = (s) => String(s || '').trim().toLowerCase();
export const findContact = (name) => S.contacts.find((c) => norm(c.name) === norm(name));

export async function ensureContact(name, phone = '') {
  name = String(name || '').trim();
  if (!name) return null;
  const c = findContact(name);
  if (c) {
    if (phone && !c.phone) { c.phone = phone; await save('contacts', c); }
    return c;
  }
  return save('contacts', { name, phone, kind: 'customer' });
}

// Positive balance: they owe you. Negative: you owe them.
export function balance(contactId) {
  let b = 0;
  for (const e of S.ledger) if (e.contactId === contactId) b += e.type === 'gave' ? e.amount : -e.amount;
  return round2(b);
}
export function isOverdue(contactId) {
  if (balance(contactId) <= 0) return false;
  const t = today();
  return S.ledger.some((e) => e.contactId === contactId && e.type === 'gave' && e.due && e.due < t);
}
export function creditTotals() {
  let get = 0, give = 0;
  for (const c of S.contacts) { const b = balance(c.id); if (b > 0) get += b; else give -= b; }
  return { get: round2(get), give: round2(give) };
}
export function lastActivity(contactId) {
  let last = '';
  for (const e of S.ledger) if (e.contactId === contactId && e.date > last) last = e.date;
  return last;
}
export async function addLedger({ contactId, type, amount, note = '', date = today(), due = '' }) {
  amount = round2(num(amount));
  if (!(amount > 0)) throw new Error('Enter an amount');
  return save('ledger', { contactId, type, amount, note, date, due: type === 'gave' ? due : '' });
}

/* ---------- Stock ---------- */
export const productByName = (name) => S.products.find((p) => norm(p.name) === norm(name));
export const lowStock = () => S.products.filter((p) => p.qty <= (p.low ?? 0));
export const stockValue = () => round2(S.products.reduce((s, p) => s + Math.max(0, p.qty) * (p.cost || p.price || 0), 0));

/* ---------- Cash book ---------- */
const cleanItems = (items) => (items || [])
  .map((i) => ({ name: String(i.name || '').trim(), qty: num(i.qty) || 1, price: num(i.price) }))
  .filter((i) => i.name && i.price >= 0);
export const itemsLabel = (items) => (items || []).map((i) => `${i.qty} ${i.name}`).join(', ');
export const itemsTotal = (items) => round2((items || []).reduce((s, i) => s + i.qty * i.price, 0));

export async function recordSale({ items = [], amount, method = 'cash', customer = '', phone = '', note = '', date = today() }) {
  items = cleanItems(items);
  const total = items.length ? itemsTotal(items) : round2(num(amount));
  if (!(total > 0)) throw new Error('Enter an amount or add items');
  if (method === 'credit' && !String(customer).trim()) throw new Error('Enter the customer who is buying on credit');
  const contact = String(customer).trim() ? await ensureContact(customer, phone) : null;

  for (const i of items) {
    const p = productByName(i.name);
    if (!p) continue;
    p.qty = round2(p.qty - i.qty);
    i.productId = p.id;
    i.cost = p.cost || 0;
    await save('products', p);
  }
  const sale = await save('cash', { type: 'in', category: 'Sale', amount: total, items, method, contactId: contact?.id || null, note, date });
  if (method === 'credit') {
    const l = await save('ledger', { contactId: contact.id, type: 'gave', amount: total, note: note || itemsLabel(items) || 'Sale on credit', date, due: addDays(date, 14), saleId: sale.id });
    sale.ledgerId = l.id;
    await save('cash', sale);
  }
  return sale;
}

export async function recordExpense({ amount, category = 'Other', method = 'cash', note = '', date = today() }) {
  amount = round2(num(amount));
  if (!(amount > 0)) throw new Error('Enter an amount');
  return save('cash', { type: 'out', category, amount, method, note, date });
}

// Undo a cash entry, putting stock back and removing the linked credit entry.
export async function deleteCash(id) {
  const e = byId('cash', id);
  if (!e) return;
  for (const i of e.items || []) {
    const p = i.productId && byId('products', i.productId);
    if (p) { p.qty = round2(p.qty + i.qty); await save('products', p); }
  }
  if (e.ledgerId) await remove('ledger', e.ledgerId);
  await remove('cash', id);
}

export function summary(from, to) {
  let sales = 0, exp = 0, count = 0, cogs = 0;
  for (const e of S.cash) {
    if (e.date < from || e.date > to) continue;
    count++;
    if (e.type === 'in') { sales += e.amount; for (const i of e.items || []) cogs += (i.cost || 0) * i.qty; }
    else exp += e.amount;
  }
  return { sales: round2(sales), exp: round2(exp), profit: round2(sales - exp), count, cogs: round2(cogs) };
}

export function dailySeries(days, end = today()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(end, -i);
    const s = summary(d, d);
    out.push({ date: d, sales: s.sales, exp: s.exp });
  }
  return out;
}

export function monthlySeries(months, end = today()) {
  const out = [];
  const first = end.slice(0, 8) + '01';
  for (let i = months - 1; i >= 0; i--) {
    const from = addMonths(first, -i);
    const to = addDays(addMonths(from, 1), -1);
    out.push({ month: from, ...summary(from, to) });
  }
  return out;
}

export function topProducts(from, to, n = 5) {
  const m = new Map();
  for (const e of S.cash) {
    if (e.type !== 'in' || e.date < from || e.date > to) continue;
    for (const i of e.items || []) {
      const r = m.get(i.name) || { name: i.name, qty: 0, amount: 0 };
      r.qty += i.qty; r.amount += i.qty * i.price;
      m.set(i.name, r);
    }
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

/* ---------- Osusu & groups ---------- */
const PERIOD = { daily: (d, n) => addDays(d, n), weekly: (d, n) => addDays(d, 7 * n), monthly: (d, n) => addMonths(d, n) };
export const roundDate = (g, r) => (PERIOD[g.frequency] || PERIOD.monthly)(g.startDate, r - 1);
export const totalRounds = (g) => (g.kind === 'osusu' ? Math.max(1, g.members.length) : null);

// The round whose date has most recently started.
export function currentRound(g) {
  const t = today();
  let r = 1;
  const max = totalRounds(g) || 520;
  while (r < max && roundDate(g, r + 1) <= t) r++;
  return r;
}
export const roundContribs = (g, r) => S.contributions.filter((c) => c.groupId === g.id && c.round === r);
export const collectorFor = (g, r) => (g.kind === 'osusu' ? g.members[(r - 1) % Math.max(1, g.members.length)] : null);
export function groupStats(g) {
  const r = currentRound(g);
  const paid = roundContribs(g, r);
  const expected = g.amount * g.members.length;
  const collected = paid.reduce((s, c) => s + c.amount, 0);
  const all = S.contributions.filter((c) => c.groupId === g.id).reduce((s, c) => s + c.amount, 0);
  return { round: r, expected, collected, unpaid: g.members.length - new Set(paid.map((p) => p.memberId)).size, all };
}
export async function toggleContribution(g, memberId, round) {
  const existing = S.contributions.find((c) => c.groupId === g.id && c.memberId === memberId && c.round === round);
  if (existing) { await remove('contributions', existing.id); return false; }
  await save('contributions', { groupId: g.id, memberId, round, amount: g.amount, date: today() });
  return true;
}

/* ---------- Invoices ---------- */
export async function nextInvoiceNumber() {
  const n = (S.settings.invSeq || 0) + 1;
  await saveSettings({ invSeq: n });
  return 'INV-' + String(n).padStart(4, '0');
}
export const invoiceCode = (inv) => refCode([S.settings.business, inv.number, inv.date, itemsTotal(inv.items), inv.customer].join('|'));

/* ---------- Business health ---------- */
export function health() {
  const t = today();
  const d30 = addDays(t, -29), d60 = addDays(t, -59), d90 = addDays(t, -89);

  const days = new Set();
  for (const k of ['cash', 'ledger', 'contributions']) for (const e of S[k]) if (e.date >= d30 && e.date <= t) days.add(e.date);
  const consistency = Math.min(1, days.size / 20) * 30;

  const now = summary(d30, t), prev = summary(d60, addDays(d30, -1));
  const margin = now.sales > 0 ? now.profit / now.sales : 0;
  const profitability = now.sales > 0 ? Math.max(0, Math.min(1, margin / 0.2)) * 25 : 0;

  let gave = 0, got = 0;
  const suppliers = new Set(S.contacts.filter((c) => c.kind === 'supplier').map((c) => c.id));
  for (const e of S.ledger) {
    if (e.date < d90 || suppliers.has(e.contactId)) continue;
    if (e.type === 'gave') gave += e.amount; else got += e.amount;
  }
  const overdue = S.contacts.filter((c) => isOverdue(c.id)).length;
  let credit = gave > 0 ? Math.min(1, got / gave) * 25 : 25;
  credit = Math.max(0, credit - overdue * 2);

  let growth = 10;
  if (prev.sales > 0) { const g = now.sales / prev.sales; growth = g >= 1.1 ? 20 : g >= 1 ? 16 : g >= 0.9 ? 11 : 6; }
  else if (now.sales > 0) growth = 14;

  const parts = [
    { label: 'Record keeping', score: consistency, max: 30, tip: `You recorded on ${days.size} of the last 30 days. Record every day, even small sales.` },
    { label: 'Profitability', score: profitability, max: 25, tip: now.sales ? `Your profit margin is ${Math.round(margin * 100)}%. Aim for 20% or more.` : 'Record your sales and expenses to measure profit.' },
    { label: 'Credit control', score: credit, max: 25, tip: overdue ? `${overdue} customer(s) are overdue. Send them reminders.` : gave ? `You collected ${Math.round(Math.min(1, got / gave) * 100)}% of credit given in 90 days.` : 'No outstanding credit risk.' },
    { label: 'Growth', score: growth, max: 20, tip: prev.sales ? `Sales are ${now.sales >= prev.sales ? 'up' : 'down'} ${Math.abs(Math.round((now.sales / prev.sales - 1) * 100))}% vs the previous 30 days.` : 'Keep recording to measure growth month to month.' },
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.score, 0));
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs work';
  return { score, label, parts, now, prev, activeDays: days.size };
}
