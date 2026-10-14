// More menu, settings, onboarding, PIN lock, backup/restore and demo data.
import { S, saveSettings, exportData, importData, resetAll, save, recordSale, recordExpense, ensureContact, addLedger, health } from '../store.js';
import { esc, today, addDays, uid, sha256, download, setCurrency, money } from '../util.js';
import { icon, actions, forms, field, options, toast, refresh, sheet, closeSheet } from '../ui.js';

const TYPES = ['Shop', 'Market trader', 'Wholesaler', 'Pharmacy', 'Restaurant / cookery', 'Salon / barber', 'Tailor / fashion', 'Transport', 'Farm', 'Services', 'School', 'Church / mosque', 'Association / NGO', 'Personal / household', 'Other'];

const menuItem = (href, ic, title, sub) => `<a class="item" href="${href}"><div class="avatar" style="background:var(--brand-soft);color:var(--brand)">${icon(ic, 18)}</div>
  <div class="main"><div class="t">${title}</div><div class="s">${sub}</div></div>${icon('chev')}</a>`;

export const routes = {
  more() {
    const h = health();
    return {
      title: 'More',
      body: `<div class="list">
        ${menuItem('#/groups', 'users', 'Osusu & Groups', `${S.groups.length} groups · savings, dues, contributions`)}
        ${menuItem('#/invoices', 'file', 'Invoices & Receipts', `${S.invoices.length} created · share on WhatsApp`)}
        ${menuItem('#/health', 'pulse', 'Business Health & Loan Report', `Score ${h.score}/100 · ${h.label}`)}
        ${menuItem('#/settings', 'sliders', 'Settings & Backup', 'Business details, AI, PIN lock, backup')}
      </div>
      <div class="card flat small"><b>Kopor works offline.</b> Your records are saved on this phone. Make a backup regularly from Settings so you never lose them.</div>`,
    };
  },

  settings() {
    const st = S.settings;
    return {
      title: 'Settings',
      back: '#/more',
      body: `
        <form class="form card" data-form="settings">
          <h3>Business</h3>
          ${field('Business name', `<input name="business" value="${esc(st.business)}" required>`)}
          ${field('Owner name', `<input name="owner" value="${esc(st.owner)}">`)}
          ${field('Business type', `<select name="type">${options(TYPES, st.type)}</select>`)}
          <div class="grid2">
            ${field('Phone', `<input name="phone" type="tel" value="${esc(st.phone)}">`)}
            ${field('Mobile money number', `<input name="momo" value="${esc(st.momo)}" placeholder="Shown on invoices">`)}
          </div>
          ${field('Address', `<input name="address" value="${esc(st.address)}">`)}
          <div class="grid3">
            ${field('Currency', `<input name="currency" value="${esc(st.currency)}">`)}
            ${field('Country code', `<input name="cc" inputmode="numeric" value="${esc(st.cc)}">`)}
            ${field('Theme', `<select name="theme">${options([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], st.theme)}</select>`)}
          </div>
          <h3 style="margin-top:8px">${icon('spark', 18)} Smart AI (optional, free)</h3>
          <div class="small muted">Get a free key at console.groq.com (or use Google Gemini / OpenRouter). Kopor sends only the sentence you speak, plus your customer and product names.</div>
          ${field('AI key', `<input name="aiKey" type="password" value="${esc(st.aiKey)}" placeholder="Leave empty to stay offline" autocomplete="off">`)}
          <div class="grid2">
            ${field('API base URL', `<input name="aiBase" value="${esc(st.aiBase)}">`)}
            ${field('Model', `<input name="aiModel" value="${esc(st.aiModel)}">`)}
          </div>
          <button class="btn primary block" type="submit">Save settings</button>
        </form>

        <div class="card stack">
          <h3>${icon('lock', 18)} PIN lock</h3>
          <div class="small muted">${st.pinHash ? 'PIN lock is on. Kopor asks for it every time it opens.' : 'Protect your records with a 4-digit PIN.'}</div>
          <button class="btn block" data-act="setPin">${st.pinHash ? 'Change or remove PIN' : 'Set a PIN'}</button>
        </div>

        <div class="card stack">
          <h3>${icon('download', 18)} Backup</h3>
          <div class="small muted">Download a backup file and keep it on WhatsApp, Google Drive or email. Restore it on any phone.</div>
          <div class="btn-row">
            <button class="btn" data-act="backup">${icon('download', 18)} Backup</button>
            <label class="btn">${icon('upload', 18)} Restore<input type="file" accept=".json,application/json" data-act-change="restore" hidden></label>
          </div>
        </div>

        <div class="card stack">
          <h3>Demo & reset</h3>
          <button class="btn block" data-act="demo">Load demo business (for trying Kopor)</button>
          <button class="btn danger block" data-act="reset">${icon('trash', 18)} Delete all data</button>
        </div>
        <div class="small muted" style="text-align:center">Kopor v1.0 · made for Salone 🇸🇱 and the world</div>`,
    };
  },
};

forms.settings = async (d) => {
  await saveSettings({
    business: d.business.trim(), owner: d.owner.trim(), type: d.type, phone: d.phone.trim(), momo: d.momo.trim(), address: d.address.trim(),
    currency: d.currency.trim() || 'Le', cc: d.cc.replace(/\D/g, '') || '232', theme: d.theme,
    aiKey: d.aiKey.trim(), aiBase: d.aiBase.trim(), aiModel: d.aiModel.trim(),
  });
  setCurrency(S.settings.currency);
  applyTheme();
  toast('Settings saved');
  refresh();
};

export function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/* ---------- Onboarding ---------- */
export function onboardingView() {
  return `<div class="shell"><div class="content" style="padding-top:32px">
    <div class="row"><div class="boot-logo" style="width:56px;height:56px;font-size:30px">K</div>
      <div><h1 style="font-size:26px">Welcome to Kopor</h1><div class="muted">Your business book, in your pocket.</div></div></div>
    <div class="card stack small">
      <div class="row">${icon('book')} <span><b>Credit book</b>: know who owes you, and send reminders on WhatsApp</span></div>
      <div class="row">${icon('cash')} <span><b>Cash book</b>: daily sales, expenses and profit</span></div>
      <div class="row">${icon('box')} <span><b>Stock</b>: low-stock alerts, auto-updated on every sale</span></div>
      <div class="row">${icon('users')} <span><b>Osusu & groups</b>: savings, dues and contributions</span></div>
      <div class="row">${icon('file')} <span><b>Invoices & receipts</b> you can share on WhatsApp</span></div>
      <div class="row">${icon('pulse')} <span><b>Health score & loan report</b> for banks and lenders</span></div>
      <div class="row">${icon('mic')} <span><b>Speak</b> your records in English or Krio</span></div>
    </div>
    <form class="form card" data-form="onboard">
      ${field('Business or group name', '<input name="business" required autofocus placeholder="e.g. Fatu\'s Provisions">')}
      ${field('Your name', '<input name="owner" placeholder="e.g. Fatmata Kamara">')}
      ${field('Type', `<select name="type">${options(TYPES, 'Shop')}</select>`)}
      ${field('Phone', '<input name="phone" type="tel" placeholder="076 123 456">')}
      <button class="btn primary block" type="submit">Start</button>
    </form>
    <button class="btn ghost block" data-act="demo">Just exploring? Load a demo business</button>
    <div class="small muted" style="text-align:center">Free · works offline · your data stays on your phone</div>
  </div></div>`;
}
forms.onboard = async (d) => {
  await saveSettings({ business: d.business.trim(), owner: d.owner.trim(), type: d.type, phone: d.phone.trim(), onboarded: true });
  location.hash = '#/home';
  refresh();
};

/* ---------- PIN lock ---------- */
export const lockState = { locked: false };
export function lockView() {
  return `<div class="shell"><div class="content" style="padding-top:20vh;align-items:center;text-align:center">
    <div class="boot-logo">${icon('lock', 32)}</div>
    <h1 style="font-size:22px">${esc(S.settings.business || 'Kopor')}</h1>
    <form class="form" data-form="unlock" style="width:220px">
      <input name="pin" type="password" inputmode="numeric" maxlength="8" class="amount-input" required autofocus placeholder="PIN" aria-label="PIN">
      <button class="btn primary block" type="submit">Unlock</button>
    </form>
  </div></div>`;
}
forms.unlock = async (d) => {
  if ((await sha256('kopor:' + d.pin)) !== S.settings.pinHash) throw new Error('Wrong PIN');
  lockState.locked = false;
  refresh();
};
actions.setPin = () => {
  sheet('PIN lock', `<form class="form" data-form="setPin">
    ${field('New PIN (4 to 8 digits). Leave empty to remove the lock.', '<input name="pin" type="password" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" autofocus>')}
    <button class="btn primary block" type="submit">Save</button>
  </form>`);
};
forms.setPin = async (d) => {
  await saveSettings({ pinHash: d.pin ? await sha256('kopor:' + d.pin) : '' });
  closeSheet();
  toast(d.pin ? 'PIN set. Do not forget it!' : 'PIN removed');
  refresh();
};

/* ---------- Backup ---------- */
actions.backup = () => {
  download(`kopor-backup-${today()}.json`, JSON.stringify(exportData()));
  toast('Backup downloaded');
};
export async function restoreFile(file) {
  if (!confirm('Restoring replaces all records on this phone with the backup. Continue?')) return;
  try {
    await importData(JSON.parse(await file.text()));
    setCurrency(S.settings.currency);
    applyTheme();
    toast('Backup restored');
    location.hash = '#/home';
    refresh();
  } catch (err) { toast(err.message || 'Could not read that file'); }
}
actions.reset = async () => {
  if (!confirm('Delete ALL records on this phone? Make a backup first. This cannot be undone.')) return;
  if (!confirm('Are you completely sure?')) return;
  await resetAll();
  location.hash = '#/home';
  refresh();
};

/* ---------- Demo data ---------- */
actions.demo = async () => {
  if ((S.cash.length || S.contacts.length) && !confirm('Add demo records on top of your existing data?')) return;
  toast('Loading demo…');
  if (!S.settings.business) await saveSettings({ business: "Fatu's Provisions", owner: 'Fatmata Kamara', type: 'Shop', phone: '076 123 456', momo: 'Orange Money 076 123 456', address: 'Kissy Road, Freetown' });
  await saveSettings({ onboarded: true });

  const products = [
    ['Rice 50kg bag', 850, 720, 24, 'bag'], ['Palm oil 4L', 180, 140, 15, 'tin'], ['Sugar 1kg', 32, 25, 40, 'packet'],
    ['Onions', 15, 10, 4, 'kg'], ['Maggi cubes (box)', 60, 45, 18, 'carton'], ['Milk tin', 25, 19, 30, 'tin'],
    ['Bread', 8, 5, 3, 'pcs'], ['Soap bar', 12, 8, 50, 'pcs'],
  ];
  for (const [name, price, cost, qty, unit] of products) await save('products', { name, price, cost, qty: qty + 60, unit, low: 5 });

  const people = [['Aminata Sesay', '076 555 101'], ['Mohamed Bangura', '088 555 202'], ['Isatu Conteh', '077 555 303'], ['Abu Kamara', '030 555 404']];
  // Sales across the last 60 days, including some on credit, with weekly restocking and monthly rent.
  let weekSales = 0;
  for (let i = 59; i >= 0; i--) {
    const date = addDays(today(), -i);
    const n = 2 + ((i * 7) % 4);
    for (let k = 0; k < n; k++) {
      const [name, price] = products[(i + k * 3) % products.length];
      const qty = 1 + ((i + k) % 3);
      const credit = (i + k) % 9 === 0;
      const sale = await recordSale({ items: [{ name, qty, price }], method: credit ? 'credit' : ['cash', 'orange', 'afrimoney', 'cash'][(i + k) % 4], customer: credit ? people[(i + k) % 4][0] : '', phone: credit ? people[(i + k) % 4][1] : '', date });
      weekSales += sale.amount;
    }
    if (i % 3 === 0) await recordExpense({ amount: 40 + (i % 5) * 15, category: ['Transport', 'Food', 'Phone & data', 'Electricity & water'][i % 4], date });
    if (i % 7 === 0) { await recordExpense({ amount: Math.round(weekSales * 0.74), category: 'Stock purchase', note: 'Weekly restock from wholesaler', date }); weekSales = 0; }
    if (date.endsWith('-01')) await recordExpense({ amount: 900, category: 'Rent', note: 'Shop rent', date });
  }
  const amin = await ensureContact('Aminata Sesay');
  await addLedger({ contactId: amin.id, type: 'got', amount: 300, note: 'Part payment', date: addDays(today(), -2) });
  const sup = await ensureContact('Kroo Bay Wholesale', '076 555 909');
  sup.kind = 'supplier';
  await save('contacts', sup);
  await addLedger({ contactId: sup.id, type: 'got', amount: 2500, note: 'Goods on credit from supplier', date: addDays(today(), -5) });

  const members = ['Fatmata Kamara', 'Aminata Sesay', 'Isatu Conteh', 'Mariama Jalloh', 'Hawa Turay', 'Kadiatu Koroma'].map((name, i) => ({ id: uid(), name, phone: `07${i} 555 6${i}${i}` }));
  const g = await save('groups', { name: 'Kissy Road Market Women Osusu', kind: 'osusu', amount: 200, frequency: 'weekly', startDate: addDays(today(), -21), members, payouts: {} });
  for (let r = 1; r <= 4; r++) for (const [j, m] of members.entries()) if (r < 4 || j % 2 === 0) await save('contributions', { groupId: g.id, memberId: m.id, round: r, amount: 200, date: addDays(g.startDate, (r - 1) * 7) });
  g.payouts = { 1: addDays(g.startDate, 0), 2: addDays(g.startDate, 7), 3: addDays(g.startDate, 14) };
  await save('groups', g);

  toast(`Demo loaded: ${money(health().now.sales)} in sales over 30 days`);
  location.hash = '#/home';
  refresh();
};
