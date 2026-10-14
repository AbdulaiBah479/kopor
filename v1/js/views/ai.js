// Voice / text entry: "Sold 2 bags rice 1200 to Fatmata on credit".
// Works offline with a rule-based parser; uses an AI model when an API key is set.
import { S, recordSale, recordExpense, ensureContact, addLedger, productByName, findContact } from '../store.js';
import { esc, money, num } from '../util.js';
import { icon, actions, forms, sheet, closeSheet, toast, refresh, methodLabel } from '../ui.js';
import { EXPENSE_CATS } from './cash.js';

let pending = null;
let recog = null;

const EXAMPLES = [
  'Sold 3 bags rice 1500 cash',
  'Aminata took 2 tins oil 400 on credit',
  'Mohamed paid me 250',
  'Spent 120 on transport',
];

actions.voice = () => {
  const canListen = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  sheet('Speak or type', `<form class="form" data-form="voice">
    <div class="small muted">Say what happened in your own words, in English or Krio. Kopor will turn it into a record for you to confirm.</div>
    <textarea name="text" required autofocus placeholder="e.g. Sold 3 bags rice 1500 to Fatmata on credit"></textarea>
    <div class="chips">${EXAMPLES.map((e) => `<button type="button" class="chip" data-act="voiceExample" data-text="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    <div class="btn-row">
      ${canListen ? `<button type="button" class="btn" data-act="listen" id="mic-btn">${icon('mic', 18)} Tap to speak</button>` : ''}
      <button type="submit" class="btn primary">${icon('spark', 18)} Understand</button>
    </div>
    <div class="small muted">${S.settings.aiKey ? 'Smart AI mode is on.' : 'Offline mode. Add a free AI key in Settings for smarter understanding.'}</div>
    <div id="ai-preview"></div>
  </form>`);
};

actions.voiceExample = ({ text }) => {
  const ta = document.querySelector('[data-form=voice] textarea');
  ta.value = text;
  ta.focus();
};

actions.listen = (_, btn) => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = 'en-GB';
  recog.interimResults = true;
  const ta = document.querySelector('[data-form=voice] textarea');
  btn.innerHTML = `${icon('mic', 18)} Listening… tap to stop`;
  btn.classList.add('primary');
  recog.onresult = (e) => { ta.value = [...e.results].map((r) => r[0].transcript).join(' '); };
  recog.onerror = (e) => toast(e.error === 'not-allowed' ? 'Allow microphone access to speak' : 'Could not hear clearly, please try again');
  recog.onend = () => {
    recog = null;
    if (!document.body.contains(btn)) return;
    btn.innerHTML = `${icon('mic', 18)} Tap to speak`;
    btn.classList.remove('primary');
    if (ta.value.trim()) btn.closest('form').requestSubmit();
  };
  recog.start();
};

forms.voice = async (d) => {
  const box = document.getElementById('ai-preview');
  box.innerHTML = '<div class="small muted">Understanding…</div>';
  let r;
  if (S.settings.aiKey) {
    try { r = await askAI(d.text); }
    catch (err) { console.warn(err); toast('AI not reachable, using offline mode'); }
  }
  r = normalize(r || parseLocal(d.text));
  pending = r;
  box.innerHTML = preview(r);
};

const LABEL = { sale: 'Sale', expense: 'Expense', credit_given: 'Credit given (they owe you)', payment_received: 'Payment received', unknown: 'Not sure' };
function preview(r) {
  if (r.action === 'unknown' || !(r.amount > 0)) {
    return `<div class="alert">${icon('alert')}<div>I could not find a clear amount and action. Try: <i>"Sold 2 bags rice 900"</i>.</div></div>`;
  }
  const rows = [
    ['Type', LABEL[r.action]],
    ['Amount', money(r.amount)],
    r.name && ['Person', r.name],
    r.item && ['Item', `${r.qty || 1} × ${r.item}`],
    r.action === 'sale' && ['Paid with', methodLabel(r.method)],
    r.action === 'expense' && ['Category', r.category],
    r.note && ['Note', r.note],
  ].filter(Boolean);
  return `<div class="card flat stack" style="margin-top:6px">
    ${rows.map(([k, v]) => `<div class="row between"><span class="muted">${k}</span><b>${esc(v)}</b></div>`).join('')}
    <div class="btn-row"><button type="button" class="btn" data-act="aiEdit">${icon('edit', 18)} Edit</button>
      <button type="button" class="btn primary" data-act="aiConfirm">${icon('check', 18)} Save</button></div>
  </div>`;
}

function saleItems(r) {
  const p = r.item && productByName(r.item);
  if (!p) return [];
  const qty = r.qty || 1;
  return [{ name: p.name, qty, price: r.amount ? r.amount / qty : p.price }];
}

actions.aiConfirm = async () => {
  const r = pending;
  if (!r) return;
  try {
    if (r.action === 'sale') {
      await recordSale({ items: saleItems(r), amount: r.amount, method: r.method, customer: r.name, note: saleItems(r).length ? '' : (r.item || r.note || '') });
    } else if (r.action === 'expense') {
      await recordExpense({ amount: r.amount, category: r.category, note: r.note || r.item || '' });
    } else {
      if (!r.name) throw new Error('Who is this for? Please edit and add a name.');
      const c = await ensureContact(r.name);
      await addLedger({ contactId: c.id, type: r.action === 'credit_given' ? 'gave' : 'got', amount: r.amount, note: r.note || (r.item ? `${r.qty || 1} ${r.item}` : '') });
    }
    pending = null;
    closeSheet();
    toast('Saved');
    refresh();
  } catch (err) { toast(err.message); }
};

actions.aiEdit = () => {
  const r = pending;
  closeSheet();
  if (r.action === 'sale') actions.newSale({}, null, { items: saleItems(r), amount: r.amount, method: r.method, customer: r.name, note: r.item || '' });
  else if (r.action === 'expense') actions.newExpense({}, null, { amount: r.amount, category: r.category, note: r.note || '' });
  else actions.newCredit();
};

/* ---------- Offline parser ---------- */
const STOP = new Set(['i', 'me', 'sold', 'sell', 'spent', 'paid', 'pay', 'bought', 'buy', 'the', 'a', 'today', 'yesterday', 'customer', 'mi', 'don', 'dem']);
export function parseLocal(text) {
  const raw = text.trim();
  const t = ' ' + raw.toLowerCase().replace(/[.,!?]/g, (c) => (c === ',' ? '' : ' ')) + ' ';

  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million)?\b/g)].map((m) => ({
    v: parseFloat(m[1]) * (m[2]?.[0] === 'k' || m[2] === 'thousand' ? 1000 : m[2]?.[0] === 'm' ? 1e6 : 1),
    i: m.index,
  }));
  const amount = nums.length ? Math.max(...nums.map((n) => n.v)) : 0;
  const qtyNum = nums.length > 1 ? nums.find((n) => n.v !== amount) : null;

  let action = 'unknown';
  if (/(paid me|pay me|don pay|has paid|have paid|repaid|paid back|pay back|received from|collected from|settled)/.test(t)) action = 'payment_received';
  else if (/(sold|sell|sale|selling)/.test(t)) action = 'sale';
  else if (/(owe|owes|on credit|trust|took|take|tek|credit|borrow)/.test(t)) action = 'credit_given';
  else if (/(spent|spend|expense|bought|buy|paid for|pay for|transport|rent|fuel|salary|light bill)/.test(t)) action = 'expense';
  else if (amount) action = 'sale';

  const method = /orange/.test(t) ? 'orange' : /afri/.test(t) ? 'afrimoney' : /bank|transfer/.test(t) ? 'bank'
    : /(credit|trust|owe)/.test(t) ? 'credit' : 'cash';

  // Person: a known contact mentioned anywhere, else a capitalised name after to/from/for, else a leading name.
  let name = S.contacts.find((c) => t.includes(' ' + c.name.toLowerCase().split(' ')[0] + ' '))?.name || '';
  if (!name) {
    const m = raw.match(/\b(?:to|from|for|by|gi|give)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || raw.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s/);
    if (m && !STOP.has(m[1].toLowerCase())) name = m[1];
  }

  const product = [...S.products].sort((a, b) => b.name.length - a.name.length)
    .find((p) => t.includes(p.name.toLowerCase()) || p.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && t.includes(' ' + w)));
  const item = product?.name || '';
  const qty = item && qtyNum ? qtyNum.v : 1;

  let category = 'Other';
  const catWords = { Transport: /transport|okada|keke|taxi|poda|bus/, Rent: /rent/, Fuel: /fuel|petrol|diesel/, Salaries: /salary|wages|staff/, 'Electricity & water': /light|electric|edsa|water/, 'Phone & data': /data|airtime|credit card|top ?up/, Food: /food|lunch|chop/, 'Stock purchase': /stock|goods|restock|bought|buy/ };
  for (const [k, re] of Object.entries(catWords)) if (re.test(t)) { category = k; break; }

  return { action, amount, name, item, qty, method: action === 'sale' ? method : 'cash', category, note: '' };
}

function normalize(r) {
  const out = {
    action: ['sale', 'expense', 'credit_given', 'payment_received'].includes(r.action) ? r.action : 'unknown',
    amount: num(r.amount),
    name: String(r.name || '').trim(),
    item: String(r.item || '').trim(),
    qty: num(r.qty) || 1,
    method: ['cash', 'orange', 'afrimoney', 'bank', 'credit'].includes(r.method) ? r.method : 'cash',
    category: EXPENSE_CATS.includes(r.category) ? r.category : 'Other',
    note: String(r.note || '').trim(),
  };
  const known = out.name && findContact(out.name);
  if (known) out.name = known.name;
  if (out.action === 'sale' && out.method === 'credit' && !out.name) out.method = 'cash';
  return out;
}

/* ---------- AI (any OpenAI-compatible endpoint: Groq, Gemini, OpenRouter…) ---------- */
async function askAI(text) {
  const st = S.settings;
  const system = `You turn a shopkeeper's message (English or Sierra Leone Krio) into one bookkeeping record.
Reply with ONLY a JSON object: {"action":"sale|expense|credit_given|payment_received|unknown","amount":number,"name":string,"item":string,"qty":number,"method":"cash|orange|afrimoney|bank|credit","category":string,"note":string}.
- "sale": they sold something. If the buyer will pay later, method is "credit" and name is the buyer.
- "credit_given": someone took goods/money and owes (no sale wording). "payment_received": someone paid back a debt.
- "expense": money spent. category is one of: ${EXPENSE_CATS.join(', ')}.
- amount is the total money. Krio hints: "don pay" = has paid, "tek" = took, "sel" = sold, "trust" = credit.
Known customers: ${S.contacts.slice(0, 80).map((c) => c.name).join(', ') || 'none'}.
Known products: ${S.products.slice(0, 80).map((p) => p.name).join(', ') || 'none'}.`;
  const res = await fetch(st.aiBase.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + st.aiKey },
    body: JSON.stringify({ model: st.aiModel, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
  });
  if (!res.ok) throw new Error('AI error ' + res.status);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI gave no JSON');
  return JSON.parse(m[0]);
}
