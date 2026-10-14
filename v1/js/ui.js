// Shared UI: icon set, event registries, bottom sheet, toast, form pieces, chart.
import { esc, money, moneyShort, weekday, fmtDate } from './util.js';
import { S } from './store.js';

// Views register handlers here; app.js wires them to delegated DOM events.
export const actions = {};   // click on [data-act="name"]
export const forms = {};     // submit of form[data-form="name"]
export const inputs = {};    // input on [data-on-input="name"]
export const hooks = { render: () => {} };
export const refresh = () => hooks.render();

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z"/><path d="M5 22V4M9 7h6"/>',
  cash: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 10h.01M18 15h.01"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chat: '<path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z"/>',
  sms: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  bank: '<path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
export const icon = (name, size = 20) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

/* ---------- Sheet & toast ---------- */
export function sheet(title, body) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-backdrop" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="closeSheet" aria-label="Close">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
    </div>`;
  root.classList.add('open');
  const first = root.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 60);
}
export function closeSheet() {
  const root = document.getElementById('sheet-root');
  root.classList.remove('open');
  root.innerHTML = '';
}
actions.closeSheet = closeSheet;

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- Form pieces ---------- */
export const field = (label, control) => `<label class="field"><span>${esc(label)}</span>${control}</label>`;
export const options = (list, selected) => list.map((o) => {
  const [v, l] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`;
}).join('');

export const METHODS = [['cash', 'Cash'], ['orange', 'Orange Money'], ['afrimoney', 'Afrimoney'], ['bank', 'Bank'], ['credit', 'On credit (customer owes)']];
export const methodLabel = (m) => (METHODS.find((x) => x[0] === m) || [m, m])[1].replace(' (customer owes)', '');

export const productList = () => `<datalist id="dl-products">${S.products.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>`;
export const contactList = () => `<datalist id="dl-contacts">${S.contacts.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>`;

// Repeating item rows (name, qty, price). Price auto-fills from stock.
export const itemRow = (i = {}) => `<div class="item-row">
  <input name="item_name" list="dl-products" placeholder="Item" value="${esc(i.name || '')}" data-on-input="itemName" autocomplete="off">
  <input name="item_qty" inputmode="decimal" placeholder="Qty" value="${esc(i.qty ?? 1)}" data-on-input="itemCalc">
  <input name="item_price" inputmode="decimal" placeholder="Price" value="${esc(i.price ?? '')}" data-on-input="itemCalc">
  <button type="button" class="icon-btn" data-act="removeItemRow" aria-label="Remove item">${icon('x', 18)}</button>
</div>`;
export const itemsEditor = (items = []) => `<div class="items-editor">
  <div class="rows">${(items.length ? items : [{}]).map(itemRow).join('')}</div>
  <button type="button" class="btn sm ghost" data-act="addItemRow">${icon('plus', 16)} Add item</button>
  <div class="total-line"><span>Total</span><span class="num" data-total>${money(0)}</span></div>
</div>${productList()}`;

export function readItems(fd) {
  const names = fd.getAll('item_name'), qtys = fd.getAll('item_qty'), prices = fd.getAll('item_price');
  return names.map((name, i) => ({ name, qty: qtys[i], price: prices[i] })).filter((i) => String(i.name).trim());
}
function recalc(form) {
  let total = 0;
  form.querySelectorAll('.item-row').forEach((r) => {
    const q = parseFloat(r.querySelector('[name=item_qty]').value) || 0;
    const p = parseFloat(String(r.querySelector('[name=item_price]').value).replace(/,/g, '')) || 0;
    total += q * p;
  });
  const t = form.querySelector('[data-total]');
  if (t) t.textContent = money(total);
  const amt = form.querySelector('[name=amount][data-auto]');
  if (amt && total > 0) amt.value = Math.round(total * 100) / 100;
}
actions.addItemRow = (_, el) => {
  el.closest('.items-editor').querySelector('.rows').insertAdjacentHTML('beforeend', itemRow());
  el.closest('.items-editor').querySelector('.item-row:last-child input').focus();
};
actions.removeItemRow = (_, el) => {
  const form = el.closest('form');
  const rows = el.closest('.rows');
  if (rows.children.length > 1) el.closest('.item-row').remove();
  else el.closest('.item-row').querySelectorAll('input').forEach((i) => { i.value = i.name === 'item_qty' ? 1 : ''; });
  recalc(form);
};
inputs.itemName = (el) => {
  const p = S.products.find((x) => x.name.toLowerCase() === el.value.trim().toLowerCase());
  if (p) el.closest('.item-row').querySelector('[name=item_price]').value = p.price;
  recalc(el.closest('form'));
};
inputs.itemCalc = (el) => recalc(el.closest('form'));
export const recalcForm = recalc;

// Filters rows that carry data-search, without re-rendering (keeps focus).
inputs.filterList = (el) => {
  const q = el.value.trim().toLowerCase();
  document.querySelectorAll(el.dataset.target + ' [data-search]').forEach((r) => {
    r.classList.toggle('hidden', q && !r.dataset.search.includes(q));
  });
};
export const searchBox = (target, placeholder) =>
  `<div class="search">${icon('search', 18)}<input type="search" placeholder="${esc(placeholder)}" data-on-input="filterList" data-target="${target}" aria-label="${esc(placeholder)}"></div>`;

export const empty = (ic, title, text) => `<div class="empty">${icon(ic, 32)}<b>${esc(title)}</b>${esc(text)}</div>`;

/* ---------- Charts ---------- */
// Grouped bars: money in vs money out per day. Hover/tap shows exact values.
export function barChart(series) {
  const W = 340, H = 150, padL = 34, padB = 20, padT = 8;
  const max = Math.max(1, ...series.flatMap((d) => [d.sales, d.exp]));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const slot = (W - padL) / series.length;
  const bw = Math.min(14, slot / 3);
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    g += `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${moneyShort(v)}</text>`;
  }
  series.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    const bar = (v, x, cls) => v > 0 ? `<path class="${cls}" d="${roundTop(x, y(v), bw, y(0) - y(v))}"/>` : '';
    g += bar(d.sales, cx - bw - 1, 'bar-in') + bar(d.exp, cx + 1, 'bar-out');
    g += `<text class="axis" x="${cx}" y="${H - 4}" text-anchor="middle">${weekday(d.date)}</text>`;
    g += `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${H - padT - padB}" rx="6"
      data-tip="${esc(`<b>${fmtDate(d.date)}</b><br>Sales ${money(d.sales)}<br>Expenses ${money(d.exp)}`)}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales and expenses for the last ${series.length} days">${g}</svg>
    <div class="legend"><span><i style="background:var(--series-in)"></i>Sales</span><span><i style="background:var(--series-out)"></i>Expenses</span></div>`;
}
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
// Bar with 4px rounded top corners, flat on the baseline.
function roundTop(x, yTop, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
}

export function scoreRing(score, size = 84) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  const color = score >= 60 ? 'var(--good)' : score >= 40 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" aria-hidden="true">
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="8"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * score / 100} ${c}"/>
  </svg><b class="num">${score}</b></div>`;
}

// One tooltip element shared by all charts.
export function initChartTips() {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  document.body.appendChild(tip);
  const show = (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.classList.remove('show'); return; }
    tip.innerHTML = t.dataset.tip;
    const r = t.getBoundingClientRect();
    tip.classList.add('show');
    const w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
  };
  document.addEventListener('pointerover', show);
  document.addEventListener('pointerdown', show);
  document.addEventListener('scroll', () => tip.classList.remove('show'), true);
}
