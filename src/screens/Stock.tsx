import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shareText } from '@/lib/share';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, Money, MoneyInput, Search, Seg } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { remove } from '@/db/repo';
import type { Product } from '@/db/schema';
import { stockLevels, stockValue, isLow, forecast, saveProduct, adjustStock } from '@/domain/stock';
import { DeleteButton } from './Credit';
import { ScanToggle } from '@/ui/extras';

const UNITS = ['pcs', 'bag', 'carton', 'kg', 'litre', 'bottle', 'packet', 'dozen', 'tin', 'bundle', 'service'];

export function StockList() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const [filter, setFilter] = useState<'all' | 'low'>('all');
  const [q, setQ] = useState('');
  const levels = useMemo(() => stockLevels(book), [book]);
  const lowCount = book.products.filter((p) => isLow(p, levels.get(p.id) ?? 0)).length;
  const rows = book.products
    .filter((p) => (filter === 'low' ? isLow(p, levels.get(p.id) ?? 0) : true))
    .filter((p) => !q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Price list to share on WhatsApp (a simple online catalogue): every product with a price, sold-out items marked.
  const catalogText = () => {
    const lines = [...book.products].filter((p) => p.price > 0).sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `• ${p.name}: ${formatMoney(p.price)}${p.unit ? `/${p.unit}` : ''}${(levels.get(p.id) ?? 0) <= 0 ? `  (${t('catalog.soldOut')})` : ''}`).join('\n');
    return t('catalog.msg', { business: book.org.name, lines, phone: book.org.phone || '—', momo: book.org.momo_number || '—' });
  };

  return (
    <Page guide="stock" title={t('stock.title')} sub={t('stock.sub', { count: book.products.length, value: formatMoney(stockValue(book)) })}
      right={book.products.length > 0 && (
        <button className="icon-btn" aria-label={t('catalog.share')} data-testid="share-catalog" onClick={() => shareText(catalogText())}><Icon name="share" size={22} /></button>
      )}
      fab={can('stock') && <button className="fab" onClick={() => openSheet(t('stock.newProduct'), <ProductSheet />)}><Icon name="plus" /> {t('stock.product')}</button>}>
      <div className="grid2">
        <div className="stat"><div className="k">{t('stock.value')}</div><div className="v"><Money v={stockValue(book)} /></div></div>
        <button className="stat" style={{ border: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}>
          <div className="k">{t('stock.low')}</div><div className={`v num ${lowCount ? 'warn' : ''}`}>{lowCount}</div>
        </button>
      </div>
      <Seg value={filter} onChange={setFilter} options={[['all', t('common.all')], ['low', t('stock.lowTab')]]} />
      <Search value={q} onChange={setQ} placeholder={t('stock.searchPh')} />
      <ScanToggle onCode={setQ} label={t('scan.find')} />
      <div className="list" id="products">
        {rows.length ? rows.map((p) => {
          const qty = levels.get(p.id) ?? 0;
          const f = forecast(book, p.id);
          return (
            <button key={p.id} type="button" className="item" style={{ width: '100%', border: 0, textAlign: 'left', font: 'inherit' }}
              onClick={() => can('stock') && openSheet(p.name, <AdjustSheet product={p} qty={qty} />)} data-product={p.name}>
              <div className="avatar"><Icon name="box" size={18} /></div>
              <div className="main">
                <div className="t">{p.name} {isLow(p, qty) && <span className={`badge ${qty <= 0 ? 'bad' : 'warn'}`}>{qty <= 0 ? t('stock.out') : t('stock.lowBadge')}</span>}</div>
                <div className="s">{formatMoney(p.price)}{p.cost > 0 && ` · ${t('stock.margin', { pct: Math.round((1 - p.cost / (p.price || 1)) * 100) })}`}{f.daysLeft !== null && qty > 0 && ` · ${t('stock.daysLeft', { days: f.daysLeft })}`}</div>
              </div>
              <div className="amt num" data-qty={qty}>{qty}<small>{p.unit}</small></div>
            </button>
          );
        }) : filter === 'low' ? <Empty icon="box" title={t('stock.allGood')} /> : <Empty icon="box" title={t('stock.noProducts')} text={t('stock.noProductsHelp')} />}
      </div>
    </Page>
  );
}

function ProductSheet({ product }: { product?: Product }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ name: product?.name ?? '', sku: product?.sku ?? '', unit: product?.unit ?? 'pcs', price: product?.price ?? 0, cost: product?.cost ?? 0, low_at: product?.low_at ?? 5, opening: 0 });
  return (
    <form className="form" data-testid="product-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await saveProduct(ctx, f, product?.id); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <Field label={t('stock.productName')}><input name="name" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Rice 50kg bag" /></Field>
      <div className="grid2">
        <Field label={t('stock.sell')}><MoneyInput name="price" required value={f.price} onChange={(price) => setF({ ...f, price })} /></Field>
        <Field label={t('stock.cost')}><MoneyInput name="cost" value={f.cost} onChange={(cost) => setF({ ...f, cost })} /></Field>
      </div>
      <div className="grid3">
        {!product && <Field label={t('stock.opening')}><input name="qty" inputMode="decimal" value={f.opening || ''} onChange={(e) => setF({ ...f, opening: Number(e.target.value) || 0 })} /></Field>}
        <Field label={t('stock.unit')}><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label={t('stock.alertAt')}><input inputMode="decimal" value={f.low_at} onChange={(e) => setF({ ...f, low_at: Number(e.target.value) || 0 })} /></Field>
      </div>
      <Field label={t('stock.sku')}><input value={f.sku} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
      <ScanToggle onCode={(sku) => setF((x) => ({ ...x, sku }))} />
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

function AdjustSheet({ product, qty }: { product: Product; qty: number }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, openSheet, toast, fail } = useOverlay();
  const [change, setChange] = useState('');
  const [expense, setExpense] = useState(true);
  return (
    <form className="form" data-testid="adjust-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await adjustStock(ctx, product.id, Number(change), { recordExpense: expense }); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <div className="card flat row between"><span>{t('stock.inStock')}</span><b className="num" style={{ fontSize: 20 }}>{qty} {product.unit}</b></div>
      <Field label={t('stock.change')}><input name="change" inputMode="decimal" required autoFocus value={change} onChange={(e) => setChange(e.target.value)} placeholder="20" /></Field>
      <label className="check"><input type="checkbox" checked={expense} onChange={(e) => setExpense(e.target.checked)} /> {t('stock.recordCost')}</label>
      <button className="btn primary block">{t('stock.update')}</button>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => openSheet(t('stock.editProduct'), <ProductSheet product={product} />)}><Icon name="edit" size={18} /> {t('common.edit')}</button>
      </div>
      <DeleteButton onDelete={async () => { await remove(ctx, 'products', product.id, `Deleted product ${product.name}`); }} />
    </form>
  );
}
