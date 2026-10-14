import { S, save, remove, byId, lowStock, stockValue, productByName, recordExpense } from '../store.js';
import { esc, money, num, round2, today } from '../util.js';
import { icon, actions, forms, sheet, closeSheet, toast, refresh, field, searchBox, empty } from '../ui.js';

const UNITS = ['pcs', 'bag', 'carton', 'kg', 'litre', 'bottle', 'packet', 'dozen', 'tin', 'bundle', 'service'];

export const routes = {
  stock(filter) {
    const low = lowStock();
    const list = (filter === 'low' ? low : [...S.products]).sort((a, b) => a.name.localeCompare(b.name));
    const rows = list.map((p) => {
      const isLow = p.qty <= (p.low ?? 0);
      return `<div class="item" data-act="productMenu" data-id="${p.id}" data-search="${esc(p.name.toLowerCase())}">
        <div class="avatar">${icon('box', 18)}</div>
        <div class="main"><div class="t">${esc(p.name)} ${isLow ? `<span class="badge ${p.qty <= 0 ? 'bad' : 'warn'}">${p.qty <= 0 ? 'Out of stock' : 'Low'}</span>` : ''}</div>
          <div class="s">Sell ${money(p.price)}${p.cost ? ' · Cost ' + money(p.cost) + ` · ${Math.round((1 - p.cost / (p.price || 1)) * 100)}% margin` : ''}</div></div>
        <div class="amt num">${p.qty}<small>${esc(p.unit || 'pcs')}</small></div>
      </div>`;
    }).join('');
    return {
      title: 'Stock',
      sub: `${S.products.length} products · value ${money(stockValue())}`,
      body: `
        <div class="grid2">
          <div class="stat"><div class="k">Stock value (cost)</div><div class="v num">${money(stockValue())}</div></div>
          <a class="stat" href="#/stock/${filter === 'low' ? '' : 'low'}"><div class="k">Low or out</div><div class="v num ${low.length ? 'warn' : ''}">${low.length}</div></a>
        </div>
        <div class="seg"><a href="#/stock" class="${filter ? '' : 'on'}">All</a><a href="#/stock/low" class="${filter === 'low' ? 'on' : ''}">Low stock</a></div>
        ${searchBox('#products', 'Search products')}
        <div class="list" id="products">${rows || empty('box', filter ? 'Nothing is low' : 'No products yet', filter ? 'All stock levels are healthy.' : 'Add products to track stock and sell faster.')}</div>`,
      fab: `<button class="fab" data-act="editProduct">${icon('plus')} Product</button>`,
    };
  },
};

actions.editProduct = ({ id } = {}) => {
  const p = (id && byId('products', id)) || { unit: 'pcs', low: 5, qty: 0 };
  sheet(id ? 'Edit product' : 'New product', `<form class="form" data-form="saveProduct">
    <input type="hidden" name="id" value="${esc(p.id || '')}">
    ${field('Product name', `<input name="name" required autofocus value="${esc(p.name || '')}" placeholder="e.g. Rice 50kg bag">`)}
    <div class="grid2">
      ${field('Selling price', `<input name="price" inputmode="decimal" required value="${esc(p.price ?? '')}">`)}
      ${field('Cost price', `<input name="cost" inputmode="decimal" value="${esc(p.cost ?? '')}" placeholder="Optional">`)}
    </div>
    <div class="grid3">
      ${field('Quantity', `<input name="qty" inputmode="decimal" value="${esc(p.qty)}">`)}
      ${field('Unit', `<select name="unit">${UNITS.map((u) => `<option${u === p.unit ? ' selected' : ''}>${u}</option>`).join('')}</select>`)}
      ${field('Alert at', `<input name="low" inputmode="decimal" value="${esc(p.low)}">`)}
    </div>
    <button class="btn primary block" type="submit">Save product</button>
  </form>`);
};
forms.saveProduct = async (d) => {
  const clash = productByName(d.name);
  if (clash && clash.id !== d.id) throw new Error('A product with this name already exists');
  const p = (d.id && byId('products', d.id)) || {};
  Object.assign(p, { name: d.name.trim(), price: num(d.price), cost: num(d.cost), qty: num(d.qty), unit: d.unit, low: num(d.low) });
  await save('products', p);
  closeSheet();
  toast('Product saved');
  refresh();
};

actions.productMenu = ({ id }) => {
  const p = byId('products', id);
  sheet(p.name, `<form class="form" data-form="adjustStock">
    <input type="hidden" name="id" value="${id}">
    <div class="card flat row between"><span>In stock</span><b class="num" style="font-size:20px">${p.qty} ${esc(p.unit || '')}</b></div>
    ${field('Add new stock (restock) or remove (use minus, e.g. -2)', `<input name="change" inputmode="decimal" required autofocus placeholder="e.g. 20">`)}
    <label class="check"><input type="checkbox" name="expense" checked> Record cost as a "Stock purchase" expense</label>
    <button class="btn primary block" type="submit">Update stock</button>
    <div class="btn-row">
      <button type="button" class="btn" data-act="editProduct" data-id="${id}">${icon('edit', 18)} Edit</button>
      <button type="button" class="btn danger" data-act="deleteProduct" data-id="${id}">${icon('trash', 18)} Delete</button>
    </div>
  </form>`);
};
forms.adjustStock = async (d) => {
  const p = byId('products', d.id);
  const change = num(d.change);
  if (!change) throw new Error('Enter a quantity');
  p.qty = round2(p.qty + change);
  await save('products', p);
  if (change > 0 && d.expense && p.cost) {
    await recordExpense({ amount: change * p.cost, category: 'Stock purchase', note: `${change} ${p.unit || ''} ${p.name}`, date: today() });
  }
  closeSheet();
  toast(`${p.name}: ${p.qty} ${p.unit || ''} in stock`);
  refresh();
};
actions.deleteProduct = async ({ id }) => {
  if (!confirm('Delete this product?')) return;
  await remove('products', id);
  closeSheet();
  refresh();
};
