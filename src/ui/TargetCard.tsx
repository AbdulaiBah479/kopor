// Daily sales target (Home): the owner sets how much the shop should sell each day; everyone sees how far today has
// got, so staff know the goal too. Sales today = money in from sales, less refunds given today.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { Field, MoneyInput } from './widgets';
import { formatMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { updateOrg } from '@/domain/org';
import type { Book } from '@/domain/book';

export function salesToday(book: Book, date = today()) {
  return book.txns.filter((x) => !x.deleted && x.date === date && x.category !== 'reversal')
    .reduce((s, x) => s + (x.type === 'in' && x.category !== 'refund' ? x.amount : x.category === 'refund' ? -x.amount : 0), 0);
}

export function TargetCard({ book }: { book: Book }) {
  const { t } = useTranslation();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const target = book.org.daily_target ?? 0;
  const set = () => openSheet(t('target.set'), <TargetSheet current={target} />);
  if (!target) return can('business') ? <button type="button" className="btn ghost block" data-testid="set-target" onClick={set}><Icon name="trendUp" size={18} /> {t('target.set')}</button> : null;
  const sold = Math.max(0, salesToday(book));
  const pct = Math.min(100, Math.round((sold / target) * 100));
  return (
    <section className="card stack" data-testid="target-card" aria-label={t('target.title')}>
      <div className="row between">
        <b>{t('target.title')}</b>
        {can('business') && <button type="button" className="icon-btn" aria-label={t('target.set')} onClick={set}><Icon name="edit" size={18} /></button>}
      </div>
      <div className="row between"><b className="num" style={{ fontSize: 22 }}>{formatMoney(sold)}</b><span className="small muted num">/ {formatMoney(target)}</span></div>
      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('target.title')}><i style={{ width: `${pct}%` }} /></div>
      <div className={`small${sold >= target ? ' good' : ''}`}>{sold >= target ? t('target.reached') : t('target.left', { amount: formatMoney(target - sold), pct })}</div>
    </section>
  );
}

function TargetSheet({ current }: { current: number }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [amount, setAmount] = useState(current);
  return (
    <form className="form" data-testid="target-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await updateOrg(ctx, { daily_target: amount > 0 ? Math.round(amount) : null }); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('target.help')}</div>
      <Field label={t('target.amount')}><MoneyInput name="target" big autoFocus value={amount} onChange={setAmount} /></Field>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}
