import { S, save, remove, byId, balance, isOverdue, creditTotals, lastActivity, ensureContact, addLedger, findContact } from '../store.js';
import { esc, money, today, addDays, fmtDate, relDate, initials, waLink, smsLink, telLink } from '../util.js';
import { icon, actions, forms, sheet, closeSheet, toast, refresh, field, options, contactList, searchBox, empty } from '../ui.js';

const dueText = (c) => {
  const due = S.ledger.filter((e) => e.contactId === c.id && e.type === 'gave' && e.due).map((e) => e.due).sort()[0];
  return due ? ` It was due on ${fmtDate(due)}.` : '';
};
export function reminderText(c) {
  const st = S.settings;
  const momo = st.momo ? ` You can pay by mobile money to ${st.momo}.` : '';
  return `Hello ${c.name}, this is a friendly reminder from ${st.business || 'us'}. Your balance is ${money(balance(c.id))}.${dueText(c)}${momo} Thank you!`;
}
function statementText(c) {
  const rows = S.ledger.filter((e) => e.contactId === c.id).sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => `${fmtDate(e.date)}: ${e.type === 'gave' ? 'Credit' : 'Paid'} ${money(e.amount)}${e.note ? ' (' + e.note + ')' : ''}`);
  return `Statement for ${c.name} from ${S.settings.business || 'Kopor'}\n\n${rows.join('\n')}\n\nBalance: ${money(balance(c.id))}`;
}

function contactRow(c) {
  const b = balance(c.id);
  const od = isOverdue(c.id);
  const last = lastActivity(c.id);
  return `<a class="item" href="#/contact/${c.id}" data-search="${esc((c.name + ' ' + (c.phone || '')).toLowerCase())}">
    <div class="avatar">${esc(initials(c.name))}</div>
    <div class="main"><div class="t">${esc(c.name)} ${od ? '<span class="badge bad">Overdue</span>' : ''}${c.kind === 'supplier' ? ' <span class="badge">Supplier</span>' : ''}</div>
      <div class="s">${last ? relDate(last) : 'No entries yet'}${c.phone ? ' · ' + esc(c.phone) : ''}</div></div>
    <div class="amt num ${b > 0 ? 'good' : b < 0 ? 'bad' : ''}">${money(Math.abs(b))}<small>${b > 0 ? 'You will get' : b < 0 ? 'You will give' : 'Settled'}</small></div>
  </a>`;
}

export const routes = {
  credit(filter) {
    const t = creditTotals();
    let list = [...S.contacts];
    if (filter === 'overdue') list = list.filter((c) => isOverdue(c.id));
    list.sort((a, b) => (isOverdue(b.id) - isOverdue(a.id)) || Math.abs(balance(b.id)) - Math.abs(balance(a.id)));
    return {
      title: 'Credit Book',
      sub: `${S.contacts.length} customers & suppliers`,
      body: `
        <div class="grid2">
          <div class="stat"><div class="k">You will get</div><div class="v num good">${money(t.get)}</div></div>
          <div class="stat"><div class="k">You will give</div><div class="v num bad">${money(t.give)}</div></div>
        </div>
        <div class="seg"><a href="#/credit" class="${filter ? '' : 'on'}">All</a><a href="#/credit/overdue" class="${filter === 'overdue' ? 'on' : ''}">Overdue</a></div>
        ${searchBox('#contacts', 'Search name or phone')}
        <div class="list" id="contacts">${list.length ? list.map(contactRow).join('') : empty('book', filter ? 'No overdue debts' : 'No customers yet', filter ? 'Everyone is paying on time.' : 'Add a customer to start tracking who owes you.')}</div>`,
      fab: `<button class="fab" data-act="newCredit">${icon('plus')} Add entry</button>`,
    };
  },

  contact(id) {
    const c = byId('contacts', id);
    if (!c) return { title: 'Not found', back: '#/credit', body: empty('book', 'Contact not found', '') };
    const b = balance(c.id);
    const entries = S.ledger.filter((e) => e.contactId === c.id).sort((a, b2) => b2.date.localeCompare(a.date) || b2.createdAt - a.createdAt);
    const cc = S.settings.cc;
    const rows = entries.map((e) => `<div class="item" data-act="entryMenu" data-id="${e.id}">
      <div class="main"><div class="t">${esc(e.note || (e.type === 'gave' ? 'Credit given' : 'Payment received'))}</div>
        <div class="s">${fmtDate(e.date)}${e.due && e.type === 'gave' ? ` · due ${fmtDate(e.due)}` : ''}</div></div>
      <div class="amt num ${e.type === 'gave' ? 'bad' : 'good'}">${money(e.amount)}<small>${e.type === 'gave' ? 'You gave' : 'You got'}</small></div>
    </div>`).join('');

    return {
      title: c.name,
      sub: c.phone || 'No phone number',
      back: '#/credit',
      right: `<button class="icon-btn" data-act="editContact" data-id="${c.id}" aria-label="Edit contact">${icon('edit')}</button>`,
      body: `
        <div class="card balance">
          <div class="muted small">${b > 0 ? 'You will get' : b < 0 ? 'You will give' : 'All settled'}</div>
          <div class="big num ${b > 0 ? 'good' : b < 0 ? 'bad' : ''}">${money(Math.abs(b))}</div>
          ${isOverdue(c.id) ? '<span class="badge bad">Overdue</span>' : ''}
        </div>
        <div class="contact-actions">
          <a href="${waLink(c.phone, reminderText(c), cc)}" target="_blank" rel="noopener">${icon('chat')}Remind</a>
          <a href="${smsLink(c.phone, reminderText(c), cc)}">${icon('sms')}SMS</a>
          <a href="${c.phone ? telLink(c.phone, cc) : '#'}">${icon('phone')}Call</a>
          <a href="${waLink(c.phone, statementText(c), cc)}" target="_blank" rel="noopener">${icon('share')}Statement</a>
        </div>
        <div class="list">${rows || empty('book', 'No entries yet', 'Record credit given or payments received below.')}</div>
        <div style="height:64px"></div>`,
      after: `<div class="sticky-actions"><div class="btn-row">
          <button class="btn give" data-act="entry" data-type="gave" data-id="${c.id}">You gave ${icon('up', 18)}</button>
          <button class="btn get" data-act="entry" data-type="got" data-id="${c.id}">You got ${icon('down', 18)}</button>
        </div></div>`,
    };
  },
};

/* ---------- Sheets ---------- */
const entryFields = (type) => `
  ${field('Amount', `<input name="amount" class="amount-input" inputmode="decimal" required autofocus placeholder="0">`)}
  ${field('Note (items, reason)', `<input name="note" placeholder="${type === 'gave' ? 'e.g. 2 bags rice' : 'e.g. part payment'}">`)}
  <div class="grid2">
    ${field('Date', `<input type="date" name="date" value="${today()}">`)}
    ${type === 'gave' ? field('Due date', `<input type="date" name="due" value="${addDays(today(), 14)}">`) : '<div></div>'}
  </div>`;

actions.newCredit = () => {
  sheet('New credit entry', `<form class="form" data-form="newCredit">
    ${field('Customer or supplier name', `<input name="name" list="dl-contacts" required autofocus autocomplete="off" placeholder="e.g. Aminata Kamara">`)}${contactList()}
    ${field('Phone (for WhatsApp/SMS reminders)', `<input name="phone" type="tel" inputmode="tel" placeholder="076 123 456">`)}
    <div class="seg" role="radiogroup">
      <label class="chip" style="flex:1;text-align:center"><input type="radio" name="type" value="gave" checked>You gave (they owe)</label>
      <label class="chip" style="flex:1;text-align:center"><input type="radio" name="type" value="got">You got (payment)</label>
    </div>
    ${entryFields('gave').replace(' autofocus', '')}
    <button class="btn primary block" type="submit">Save</button>
  </form>`);
};
forms.newCredit = async (d) => {
  const c = await ensureContact(d.name, d.phone);
  await addLedger({ contactId: c.id, type: d.type, amount: d.amount, note: d.note, date: d.date, due: d.due });
  closeSheet();
  toast('Saved');
  location.hash = '#/contact/' + c.id;
  refresh();
};

actions.entry = ({ type, id }) => {
  const c = byId('contacts', id);
  sheet(`${type === 'gave' ? 'You gave' : 'You got'} · ${c.name}`, `<form class="form" data-form="entry">
    <input type="hidden" name="contactId" value="${id}"><input type="hidden" name="type" value="${type}">
    ${entryFields(type)}
    <button class="btn ${type === 'gave' ? 'give' : 'get'} block" type="submit">Save</button>
  </form>`);
};
forms.entry = async (d) => {
  await addLedger(d);
  closeSheet();
  toast('Saved');
  refresh();
};

actions.entryMenu = ({ id }) => {
  const e = byId('ledger', id);
  sheet('Entry', `<div class="stack">
    <div class="card flat"><b class="num">${money(e.amount)}</b> · ${e.type === 'gave' ? 'You gave' : 'You got'}<div class="muted small">${fmtDate(e.date)} ${esc(e.note || '')}</div></div>
    <button class="btn danger block" data-act="deleteEntry" data-id="${id}">${icon('trash', 18)} Delete entry</button>
  </div>`);
};
actions.deleteEntry = async ({ id }) => {
  if (!confirm('Delete this entry?')) return;
  await remove('ledger', id);
  closeSheet();
  toast('Deleted');
  refresh();
};

actions.editContact = ({ id }) => {
  const c = byId('contacts', id);
  sheet('Edit contact', `<form class="form" data-form="editContact">
    <input type="hidden" name="id" value="${id}">
    ${field('Name', `<input name="name" required value="${esc(c.name)}">`)}
    ${field('Phone', `<input name="phone" type="tel" value="${esc(c.phone || '')}">`)}
    ${field('Type', `<select name="kind">${options([['customer', 'Customer'], ['supplier', 'Supplier']], c.kind)}</select>`)}
    <button class="btn primary block" type="submit">Save</button>
    <button class="btn danger block" type="button" data-act="deleteContact" data-id="${id}">${icon('trash', 18)} Delete contact and entries</button>
  </form>`);
};
forms.editContact = async (d) => {
  const c = byId('contacts', d.id);
  const clash = findContact(d.name);
  if (clash && clash.id !== c.id) throw new Error('Another contact already has that name');
  Object.assign(c, { name: d.name.trim(), phone: d.phone.trim(), kind: d.kind });
  await save('contacts', c);
  closeSheet();
  refresh();
};
actions.deleteContact = async ({ id }) => {
  if (!confirm('Delete this contact and all their entries?')) return;
  for (const e of S.ledger.filter((x) => x.contactId === id)) await remove('ledger', e.id);
  await remove('contacts', id);
  closeSheet();
  location.hash = '#/credit';
};
