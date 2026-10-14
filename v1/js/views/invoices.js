import { S, save, remove, byId, nextInvoiceNumber, invoiceCode, itemsTotal, recordSale, addLedger, ensureContact } from '../store.js';
import { esc, money, num, today, addDays, fmtDate, waLink } from '../util.js';
import { icon, actions, forms, sheet, closeSheet, toast, refresh, field, options, METHODS, itemsEditor, readItems, contactList, empty, searchBox } from '../ui.js';

const isOverdue = (inv) => inv.status !== 'paid' && inv.dueDate && inv.dueDate < today();

export const routes = {
  invoices() {
    const list = [...S.invoices].sort((a, b) => b.number.localeCompare(a.number));
    const unpaid = list.filter((i) => i.status !== 'paid');
    const rows = list.map((inv) => `<a class="item" href="#/invoice/${inv.id}" data-search="${esc((inv.number + ' ' + inv.customer).toLowerCase())}">
      <div class="avatar">${icon('file', 18)}</div>
      <div class="main"><div class="t">${esc(inv.customer)} <span class="badge ${inv.status === 'paid' ? 'good' : isOverdue(inv) ? 'bad' : 'warn'}">${inv.status === 'paid' ? 'Paid' : isOverdue(inv) ? 'Overdue' : 'Unpaid'}</span></div>
        <div class="s">${esc(inv.number)} · ${fmtDate(inv.date)}</div></div>
      <div class="amt num">${money(itemsTotal(inv.items))}</div>
    </a>`).join('');
    return {
      title: 'Invoices & Receipts',
      sub: `${unpaid.length} unpaid · ${money(unpaid.reduce((s, i) => s + itemsTotal(i.items), 0))}`,
      back: '#/more',
      body: `${list.length > 4 ? searchBox('#invoices', 'Search invoices') : ''}
        <div class="list" id="invoices">${rows || empty('file', 'No invoices yet', 'Create professional invoices and receipts to share on WhatsApp or print.')}</div>`,
      fab: `<button class="fab" data-act="newInvoice">${icon('plus')} Invoice</button>`,
    };
  },

  invoice(id) {
    const inv = byId('invoices', id);
    if (!inv) return { title: 'Not found', back: '#/invoices', body: empty('file', 'Invoice not found', '') };
    const st = S.settings;
    const total = itemsTotal(inv.items);
    const code = invoiceCode(inv);
    const paid = inv.status === 'paid';
    return {
      title: inv.number,
      sub: paid ? 'Paid' : 'Unpaid',
      back: '#/invoices',
      body: `
        <div class="doc">
          <div class="row between" style="align-items:flex-start">
            <div><h2>${esc(st.business || 'My Business')}</h2>
              <div class="small">${esc(st.address || '')}${st.phone ? '<br>' + esc(st.phone) : ''}</div></div>
            <div style="text-align:right"><b style="font-size:18px">${paid ? 'RECEIPT' : 'INVOICE'}</b><div class="small">${esc(inv.number)}</div>
              <div class="stamp" style="color:${paid ? '#0b7a3b' : '#a8650a'};margin-top:6px">${paid ? 'PAID' : 'DUE'}</div></div>
          </div>
          <div class="meta" style="margin-top:16px">
            <div><div class="small">Bill to</div><b>${esc(inv.customer)}</b>${inv.phone ? '<br>' + esc(inv.phone) : ''}</div>
            <div style="text-align:right"><div class="small">Date: ${fmtDate(inv.date)}</div>${!paid && inv.dueDate ? `<div class="small">Due: ${fmtDate(inv.dueDate)}</div>` : ''}${paid ? `<div class="small">Paid: ${fmtDate(inv.paidDate)}</div>` : ''}</div>
          </div>
          <table>
            <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead>
            <tbody>${inv.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r">${i.qty}</td><td class="r">${money(i.price)}</td><td class="r">${money(i.qty * i.price)}</td></tr>`).join('')}
              <tr class="tot"><td colspan="3">Total</td><td class="r">${money(total)}</td></tr></tbody>
          </table>
          ${inv.notes ? `<div class="small">${esc(inv.notes)}</div>` : ''}
          ${!paid && st.momo ? `<div class="small" style="margin-top:8px"><b>Pay by mobile money:</b> ${esc(st.momo)}</div>` : ''}
          <div class="foot">Verification code: <b>${code}</b> · Generated with Kopor</div>
        </div>
        <div class="btn-row no-print">
          <a class="btn get" href="${waLink(inv.phone, shareText(inv, code), st.cc)}" target="_blank" rel="noopener">${icon('chat', 18)} WhatsApp</a>
          <button class="btn" data-act="print">${icon('print', 18)} Print / PDF</button>
        </div>
        <div class="btn-row no-print">
          ${paid ? '' : `<button class="btn primary" data-act="markPaid" data-id="${id}">${icon('check', 18)} Mark as paid</button>`}
          <button class="btn danger" data-act="deleteInvoice" data-id="${id}">${icon('trash', 18)} Delete</button>
        </div>`,
    };
  },
};

function shareText(inv, code) {
  const st = S.settings;
  const lines = inv.items.map((i) => `• ${i.qty} x ${i.name}: ${money(i.qty * i.price)}`).join('\n');
  const paid = inv.status === 'paid';
  return `*${paid ? 'RECEIPT' : 'INVOICE'} ${inv.number}* from ${st.business || 'us'}\nDate: ${fmtDate(inv.date)}\n\n${lines}\n\n*Total: ${money(itemsTotal(inv.items))}*${paid ? '\nStatus: PAID ✅' : inv.dueDate ? `\nDue: ${fmtDate(inv.dueDate)}` : ''}${!paid && st.momo ? `\nPay by mobile money: ${st.momo}` : ''}\n\nVerification code: ${code}`;
}

actions.print = () => window.print();

actions.newInvoice = () => {
  sheet('New invoice', `<form class="form" data-form="newInvoice">
    ${field('Customer name', `<input name="customer" list="dl-contacts" required autofocus autocomplete="off">`)}${contactList()}
    ${field('Customer phone', `<input name="phone" type="tel" placeholder="Optional, for WhatsApp">`)}
    ${itemsEditor()}
    <div class="grid2">
      ${field('Date', `<input type="date" name="date" value="${today()}">`)}
      ${field('Due date', `<input type="date" name="dueDate" value="${addDays(today(), 7)}">`)}
    </div>
    ${field('Notes / terms', `<input name="notes" placeholder="e.g. Thank you for your business">`)}
    ${field('Status', `<select name="status">${options([['unpaid', 'Unpaid: add to credit book'], ['paid', 'Paid now: receipt']], 'unpaid')}</select>`)}
    ${field('If paid, paid with', `<select name="method">${options(METHODS.filter((m) => m[0] !== 'credit'), 'cash')}</select>`)}
    <button class="btn primary block" type="submit">Create</button>
  </form>`);
};
forms.newInvoice = async (d) => {
  const items = readItems(d._fd).map((i) => ({ name: i.name.trim(), qty: num(i.qty) || 1, price: num(i.price) }));
  if (!items.length || !(itemsTotal(items) > 0)) throw new Error('Add at least one item with a price');
  const paid = d.status === 'paid';
  const sale = await recordSale({ items, method: paid ? d.method : 'credit', customer: d.customer, phone: d.phone, date: d.date, note: 'Invoice' });
  const inv = await save('invoices', {
    number: await nextInvoiceNumber(), customer: d.customer.trim(), phone: d.phone.trim(), items, date: d.date,
    dueDate: d.dueDate, notes: d.notes, status: paid ? 'paid' : 'unpaid', paidDate: paid ? d.date : '', saleId: sale.id,
    contactId: sale.contactId,
  });
  sale.note = inv.number;
  await save('cash', sale);
  if (sale.ledgerId) { const l = byId('ledger', sale.ledgerId); l.note = `${inv.number}: ${l.note}`; l.due = d.dueDate; await save('ledger', l); }
  closeSheet();
  location.hash = '#/invoice/' + inv.id;
  refresh();
};

actions.markPaid = async ({ id }) => {
  const inv = byId('invoices', id);
  const c = inv.contactId ? byId('contacts', inv.contactId) : await ensureContact(inv.customer, inv.phone);
  await addLedger({ contactId: c.id, type: 'got', amount: itemsTotal(inv.items), note: `${inv.number} paid`, date: today() });
  Object.assign(inv, { status: 'paid', paidDate: today(), contactId: c.id });
  await save('invoices', inv);
  toast('Marked as paid. It is now a receipt.');
  refresh();
};
actions.deleteInvoice = async ({ id }) => {
  if (!confirm('Delete this invoice? The linked sale and credit entries stay in your books.')) return;
  await remove('invoices', id);
  location.hash = '#/invoices';
};
