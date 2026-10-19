// Point-of-sale building blocks (the Square / Shopify POS way of selling): tap product tiles to fill the cart,
// and tap a payment method instead of choosing from a list.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LineItem, Method, Product } from '@/db/schema';
import type { Book } from '@/domain/book';
import { stockLevels } from '@/domain/stock';
import { addDays, today } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { fold } from '@/lib/fuzzy';

/** Products ordered by how often they sold in the last 30 days (best sellers first), then by name. */
export function bestSellersFirst(book: Book): Product[] {
  const from = addDays(today(), -29), n = new Map<string, number>();
  for (const t of book.txns) if (t.type === 'in' && t.date >= from) for (const i of t.items) if (i.product_id) n.set(i.product_id, (n.get(i.product_id) ?? 0) + i.qty);
  return [...book.products].sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}

/** Add one of this product to the cart (or one more, if it is already there). */
export function addToCart(items: Partial<LineItem>[], p: Product): Partial<LineItem>[] {
  const real = items.filter((i) => i.name?.trim());
  const k = real.findIndex((i) => i.product_id === p.id);
  return k >= 0 ? real.map((i, j) => (j === k ? { ...i, qty: (i.qty ?? 0) + 1 } : i)) : [...real, { product_id: p.id, name: p.name, qty: 1, price: p.price }];
}

export function ProductTiles({ book, items, onAdd }: { book: Book; items: Partial<LineItem>[]; onAdd: (p: Product) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const ordered = useMemo(() => bestSellersFirst(book), [book]);
  const levels = useMemo(() => stockLevels(book), [book]);
  if (!book.products.length) return null;
  const list = q ? ordered.filter((p) => fold(p.name).includes(fold(q))) : ordered;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {book.products.length > 8 && <input className="input" type="search" placeholder={t('pos.search')} aria-label={t('pos.search')} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="pos-tiles" data-testid="pos-tiles">
        {list.slice(0, q ? 30 : 12).map((p) => {
          const inCart = items.find((i) => i.product_id === p.id)?.qty ?? 0;
          const left = levels.get(p.id) ?? 0;
          return (
            <button type="button" key={p.id} className={`pos-tile${inCart ? ' on' : ''}`} data-product={p.name} onClick={() => onAdd(p)}
              aria-label={`${p.name}, ${formatMoney(p.price)}${inCart ? `, ${t('pos.inCart', { n: inCart })}` : ''}`}>
              <span className="pos-name">{p.name}</span>
              <span className="pos-price num">{formatMoney(p.price)}</span>
              <span className={`pos-left${left <= p.low_at ? ' low' : ''}`}>{t('pos.left', { n: left })}</span>
              {inCart > 0 && <span className="pos-badge num" aria-hidden="true">{inCart}</span>}
            </button>
          );
        })}
        {q && !list.length && <div className="small muted">{t('pos.none')}</div>}
      </div>
    </div>
  );
}

export function MethodChips({ value, onChange, methods }: { value: Method; onChange: (m: Method) => void; methods: Method[] }) {
  const { t } = useTranslation();
  return (
    <div className="chips" role="radiogroup" aria-label={t('cash.method')} data-testid="method-chips">
      {methods.map((m) => (
        <button type="button" key={m} role="radio" aria-checked={m === value} className={`chip${m === value ? ' on' : ''}`} onClick={() => onChange(m)}>{t(`methods.${m}`)}</button>
      ))}
    </div>
  );
}
