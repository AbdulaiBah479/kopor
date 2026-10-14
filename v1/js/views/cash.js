import { S, byId, summary, recordSale, recordExpense, deleteCash, itemsLabel, topProducts } from '../store.js';
import { esc, money, today, addDays, relDate, fmtDate } from '../util.js';
import { icon, actions, forms, sheet, closeSheet, toast, refresh, field, options, METHODS, methodLabel, itemsEditor, readItems, contactList, empty, recalcForm } from '../ui.js';

export const EXPENSE_CATS = ['Stock purchase', 'Rent', 'Transport', 'Salaries', 'Electricity & water', 'Phone & data', 'Fuel', 'Food', 'Repairs', 'Taxes & fees', 'Loan repayment', 'Other'];

const RANGES = {
  today: ['Today', () => [today(), today()]],
  week: ['7 days', () => [addDays(today(), -6), today()]],
  month: ['This month', () => [today().slice(0, 8) + '01', today()]],
  all: ['All', () => ['0000-00-00', '9999-12-31']],
};

export const routes = {
  cash(range = 'week') {
    const [from, to] = (RANGES[range] || RANGES.week)[1]();
    const s = summary(from, to);
    const entries = S.cash.filter((e) => e.date >= from && e.date <= to).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const byDay = new Map();
    for (const e of entries) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
    const top = topProducts(from, to, 3);

    let list = '';
    for (const [date, rows] of byDay) {
      const net = rows.reduce((t, e) => t + (e.type === 'in' ? e.amount : -e.amount), 0);
      list += `<div class="day-head"><span>${relDate(date)}</span><span class="num">${money(net, { sign: true })}</span></div>`;
      list += rows.map((e) => `<div class="item" data-act="cashMenu" data-id="${e.id}">
        <div class="avatar" style="background:${e.type === 'in' ? 'var(--good-soft)' : 'var(--warn-soft)'};color:${e.type === 'in' ? 'var(--good)' : 'var(--warn)'}">${icon(e.type === 'in' ? 'plus' : 'minus', 18)}</div>
        <div class="main"><div class="t">${esc(e.type === 'in' ? (itemsLabel(e.items) || e.note || 'Sale') : e.category)}</div>
          <div class="s">${esc(methodLabel(e.method))}${e.contactId ? ' · ' + esc(byId('contacts', e.contactId)?.name || '') : ''}${e.type === 'out' && e.note ? ' · ' + esc(e.note) : ''}</div></div>
        <div class="amt num ${e.type === 'in' ? 'good' : 'bad'}">${e.type === 'in' ? '+' : '-'}${money(e.amount)}</div>
      </div>`).join('');
    }

    return {
      title: 'Cash Book',
      sub: 'Sales, expenses and profit',
      body: `
        <div class="seg">${Object.entries(RANGES).map(([k, [l]]) => `<a href="#/cash/${k}" class="${k === range ? 'on' : ''}">${l}</a>`).join('')}</div>
        <div class="grid3">
          <div class="stat"><div class="k">Sales</div><div class="v num good">${money(s.sales)}</div></div>
          <div class="stat"><div class="k">Expenses</div><div class="v num bad">${money(s.exp)}</div></div>
          <div class="stat"><div class="k">Profit</div><div class="v num">${money(s.profit)}</div></div>
        </div>
        ${top.length ? `<div class="card flat small"><b>Best sellers:</b> ${top.map((p) => `${esc(p.name)} (${money(p.amount)})`).join(' · ')}</div>` : ''}
        <div class="list">${list || empty('cash', 'Nothing recorded', 'Record your first sale or expense.')}</div>
        <div style="height:56px"></div>`,
      after: `<div class="sticky-actions"><div class="btn-row">
        <button class="btn get" data-act="newSale">${icon('plus', 18)} Sale</button>
        <button class="btn give" data-act="newExpense">${icon('minus', 18)} Expense</button>
      </div></div>`,
    };
  },
};

actions.newSale = (_, __, prefill = {}) => {
  sheet('New sale', `<form class="form" data-form="newSale">
    ${itemsEditor(prefill.items || [])}
    ${field('Amount (auto from items, or type it)', `<input name="amount" data-auto class="amount-input" inputmode="decimal" placeholder="0" value="${esc(prefill.amount || '')}">`)}
    ${field('Payment method', `<select name="method">${options(METHODS, prefill.method || 'cash')}</select>`)}
    ${field('Customer (needed for credit)', `<input name="customer" list="dl-contacts" autocomplete="off" placeholder="Optional" value="${esc(prefill.customer || '')}">`)}${contactList()}
    <div class="grid2">
      ${field('Date', `<input type="date" name="date" value="${today()}">`)}
      ${field('Note', `<input name="note" placeholder="Optional" value="${esc(prefill.note || '')}">`)}
    </div>
    <button class="btn get block" type="submit">${icon('check', 18)} Save sale</button>
  </form>`);
  const form = document.querySelector('[data-form=newSale]');
  if (prefill.items?.length) recalcForm(form);
};
forms.newSale = async (d) => {
  await recordSale({ items: readItems(d._fd), amount: d.amount, method: d.method, customer: d.customer, note: d.note, date: d.date });
  closeSheet();
  toast(d.method === 'credit' ? 'Sale saved and added to credit book' : 'Sale saved');
  refresh();
};

actions.newExpense = (_, __, prefill = {}) => {
  sheet('New expense', `<form class="form" data-form="newExpense">
    ${field('Amount', `<input name="amount" class="amount-input" inputmode="decimal" required autofocus placeholder="0" value="${esc(prefill.amount || '')}">`)}
    ${field('Category', `<select name="category">${options(EXPENSE_CATS, prefill.category || 'Other')}</select>`)}
    ${field('Paid with', `<select name="method">${options(METHODS.filter((m) => m[0] !== 'credit'), 'cash')}</select>`)}
    <div class="grid2">
      ${field('Date', `<input type="date" name="date" value="${today()}">`)}
      ${field('Note', `<input name="note" placeholder="Optional" value="${esc(prefill.note || '')}">`)}
    </div>
    <button class="btn give block" type="submit">${icon('check', 18)} Save expense</button>
  </form>`);
};
forms.newExpense = async (d) => {
  await recordExpense(d);
  closeSheet();
  toast('Expense saved');
  refresh();
};

actions.cashMenu = ({ id }) => {
  const e = byId('cash', id);
  const items = (e.items || []).map((i) => `<tr><td>${esc(i.name)}</td><td class="r num">${i.qty}</td><td class="r num">${money(i.qty * i.price)}</td></tr>`).join('');
  sheet(e.type === 'in' ? 'Sale' : 'Expense', `<div class="stack">
    <div class="card flat">
      <div class="row between"><b class="num" style="font-size:22px">${money(e.amount)}</b><span class="badge">${esc(methodLabel(e.method))}</span></div>
      <div class="muted small">${fmtDate(e.date)} · ${esc(e.category)}${e.note ? ' · ' + esc(e.note) : ''}</div>
      ${items ? `<table style="width:100%;margin-top:8px;font-size:14px">${items}</table>` : ''}
    </div>
    <button class="btn danger block" data-act="deleteCash" data-id="${id}">${icon('trash', 18)} Delete${e.items?.length ? ' (stock will be returned)' : ''}</button>
  </div>`);
};
actions.deleteCash = async ({ id }) => {
  if (!confirm('Delete this entry?')) return;
  await deleteCash(id);
  closeSheet();
  toast('Deleted');
  refresh();
};
