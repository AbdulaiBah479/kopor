import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Book } from '@/domain/book';
import { moneyNow } from '@/domain/moneyNow';
import { Money } from './widgets';
import { Icon } from './Icon';

/** Owners and managers: where the money is right now. */
export function MoneyNow({ book }: { book: Book }) {
  const { t } = useTranslation();
  const m = moneyNow(book);
  const row = (label: string, v: number, to: string, tone = '') => (
    <Link to={to} className="row between" style={{ color: 'inherit' }}><span className="small">{label}</span><Money v={v} className={tone} /></Link>
  );
  return (
    <section className="card stack" data-testid="money-now" aria-label={t('now.title')}>
      <b><Icon name="wallet" size={18} className="mr-1 inline" />{t('now.title')}</b>
      {row(m.since ? t('now.drawerSince') : t('now.drawer'), m.drawer, '/cash')}
      {m.momo.map(([k, v]) => <div key={k}>{row(t('now.momo', { network: t(`methods.${k}`) }), v, '/cash')}</div>)}
      {row(t('home.youGet'), m.owedToYou, '/credit', 'good')}
      {m.youOwe > 0 && row(t('home.youGive'), m.youOwe, '/credit', 'bad')}
      {row(t('now.stock'), m.stock, '/stock')}
      <div className="small muted">{t('now.help')}</div>
    </section>
  );
}
