// "Get ready for Eid / Christmas / school": what sold more before the same date last year, and how much to buy.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Book } from '@/domain/book';
import { seasonPlan } from '@/domain/seasons';
import { today } from '@/lib/dates';
import { Icon } from './Icon';

export function SeasonCard({ book, limit = 3, full = false }: { book: Book; limit?: number; full?: boolean }) {
  const { t } = useTranslation();
  const tips = seasonPlan(book, today());
  if (!tips.length) return null;
  const first = tips[0];
  const shown = (full ? tips : tips.filter((x) => x.event.key === first.event.key)).slice(0, full ? 20 : limit);
  return (
    <div className="card stack" data-testid="season-card">
      <div className="row between"><b><Icon name="calendar" size={18} /> {t('season.title', { event: t(`season.ev.${first.event.key}`), days: first.days })}</b>
        {!full && <Link className="small" to="/stock">{t('season.more')}</Link>}</div>
      <div className="list">
        {shown.map((x) => (
          <div key={`${x.event.key}-${x.product.id}`} className="item" data-product={x.product.name}>
            <div className="main">
              <div className="t">{x.product.name}{full && x.event.key !== first.event.key ? ` · ${t(`season.ev.${x.event.key}`)}` : ''}</div>
              <div className="s">{t('season.why', { times: x.times, need: x.need, have: x.have, unit: x.product.unit })}</div>
            </div>
            <div className="amt num">{x.buy > 0 ? <span className="warn">{t('season.buy', { n: x.buy })}</span> : <span className="good">{t('season.enough')}</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
