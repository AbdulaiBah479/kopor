// Today's to-do list on Home (domain/todo.ts). Tap an item to go and do it; tick it to hide it until tomorrow.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { Icon } from './Icon';
import { formatMoney } from '@/lib/money';
import { getMeta, setMeta } from '@/db/repo';
import { doneKey, todayList, type Todo } from '@/domain/todo';
import type { Book } from '@/domain/book';

export function TodayCard({ book, unseenAlerts }: { book: Book; unseenAlerts: number }) {
  const { t } = useTranslation();
  const { ctx, can } = useApp();
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => { getMeta<string[]>(doneKey(ctx.orgId), []).then(setDone).catch(() => {}); }, [ctx.orgId]);
  const items = useMemo(() => todayList(book, { unseenAlerts, bills: can('business') }), [book, unseenAlerts, can]);
  const shown = items.filter((i) => !done.includes(i.key));
  if (!items.length) return null;
  const tick = (i: Todo) => { const next = [...done, i.key]; setDone(next); void setMeta(doneKey(ctx.orgId), next); };
  const text = (i: Todo) => t(`todo.${i.kind}`, { ...i.params, amount: typeof i.params.amount === 'number' ? formatMoney(i.params.amount) : '',
    ...(i.kind === 'budget' ? { category: t(`categories.${i.params.category}`) } : {}) });
  return (
    <section className="card stack" data-testid="today-card" aria-label={t('todo.title')}>
      <div className="row between"><b><Icon name="check" size={18} className="mr-1 inline" />{t('todo.title')}</b><span className="small muted">{shown.length ? t('todo.left', { count: shown.length }) : ''}</span></div>
      {shown.length ? shown.map((i) => (
        <div key={i.key} className="row between" style={{ gap: 8 }} data-testid="todo" data-kind={i.kind}>
          <Link to={i.to} className={`small${i.urgent ? ' bad' : ''}`} style={{ flex: 1 }}>{text(i)}</Link>
          <button type="button" className="icon-btn" aria-label={t('todo.done')} onClick={() => tick(i)}><Icon name="check" size={18} /></button>
        </div>
      )) : <div className="small good">{t('todo.allDone')}</div>}
    </section>
  );
}
