// Supplier price watch card (Stock screen): items whose cost went up or down since the last purchase, or that now
// sell at a loss, with a suggested price that keeps the old margin, applied with one tap.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { formatMoney } from '@/lib/money';
import { priceWatch, setPrice } from '@/domain/prices';

export function PriceWatchCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { toast, fail } = useOverlay();
  const flags = useMemo(() => priceWatch(book), [book]);
  if (!flags.length) return null;
  return (
    <section className="card stack" data-testid="price-watch" aria-label={t('prices.title')}>
      <b><Icon name="trendUp" size={18} className="mr-1 inline" />{t('prices.title')}</b>
      {flags.slice(0, 6).map((f) => (
        <div key={f.product.id} className="stack" style={{ gap: 4 }} data-testid="price-flag" data-product={f.product.name} data-kind={f.kind}>
          <div className={f.kind === 'loss' ? 'bad' : ''}>
            {t(`prices.${f.kind}`, { name: f.product.name, pct: Math.round(Math.abs(f.change) * 100), old: formatMoney(f.oldCost), now: formatMoney(f.newCost), price: formatMoney(f.product.price) })}
            {f.supplier && <span className="small muted"> · {f.supplier}</span>}
          </div>
          {f.suggested > 0 && (
            <button type="button" className="btn sm tinted" style={{ justifySelf: 'start' }} data-testid="use-price"
              onClick={async () => { try { await setPrice(ctx, f.product, f.suggested); toast(t('prices.updated', { name: f.product.name, price: formatMoney(f.suggested) })); } catch (e) { fail(e); } }}>
              {t('prices.use', { price: formatMoney(f.suggested) })}
            </button>
          )}
        </div>
      ))}
      <div className="small muted">{t('prices.help')}</div>
    </section>
  );
}
