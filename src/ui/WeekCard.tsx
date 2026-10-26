import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Book } from '@/domain/book';
import { summary } from '@/domain/cash';
import { byPerson, watchFlags } from '@/domain/watch';
import { addDays, today } from '@/lib/dates';
import { getMeta, setMeta } from '@/db/repo';
import { Money } from './widgets';
import { Icon } from './Icon';

/** Monday to Sunday of last week. */
export function lastWeek(now = today()) {
  const d = new Date(`${now}T12:00:00`);
  const monday = addDays(now, -((d.getDay() + 6) % 7));
  return { from: addDays(monday, -7), to: addDays(monday, -1) };
}

/** Owner's weekly report on Home (Monday to Wednesday): sales, profit, who was late or absent, warnings by person. */
export function WeekCard({ book }: { book: Book }) {
  const { t } = useTranslation();
  const now = today();
  const { from, to } = lastWeek(now);
  const [hidden, setHidden] = useState(true);
  useEffect(() => { getMeta('weekHidden', '').then((w) => setHidden(w === from)); }, [from]);
  const dow = new Date(`${now}T12:00:00`).getDay();
  if (hidden || ![1, 2, 3].includes(dow)) return null;
  const s = summary(book, from, to);
  if (!s.sales && !s.expenses) return null;
  const days = Math.round((Date.parse(now) - Date.parse(from)) / 86_400_000) + 1;
  const people = byPerson(watchFlags(book, [], days, to).filter((f) => f.date >= from)).slice(0, 3);
  const att = new Map<string, { late: number; absent: number }>();
  for (const a of book.attendance) {
    if (a.deleted || a.date < from || a.date > to || !['late', 'absent'].includes(a.status)) continue;
    const r = att.get(a.member_id) ?? { late: 0, absent: 0 };
    if (a.status === 'late') r.late++; else r.absent++;
    att.set(a.member_id, r);
  }
  const name = (id: string) => book.members.find((m) => m.id === id)?.name.split(' ')[0] ?? '—';
  return (
    <section className="card stack" data-testid="week-card" aria-label={t('week.title')}>
      <div className="row between"><b><Icon name="calendar" size={18} className="mr-1 inline" />{t('week.title')}</b>
        <button className="icon-btn" aria-label={t('common.close')} onClick={() => { setHidden(true); void setMeta('weekHidden', from); }}><Icon name="x" size={18} /></button></div>
      <div className="grid2">
        <div><div className="small muted">{t('ux.salesFor')}</div><Money v={s.sales} className="good" /></div>
        <div><div className="small muted">{t('week.profit')}</div><Money v={s.profit} className={s.profit < 0 ? 'bad' : ''} /></div>
      </div>
      {att.size > 0 && <div className="small">{t('week.attendance')}: {[...att.entries()].map(([id, r]) => `${name(id)} ${t('week.lateAbsent', { late: r.late, absent: r.absent })}`).join(' · ')}</div>}
      <div className="small">{people.length ? `${t('week.warnings')}: ${people.map((p) => `${p.who.split(' ')[0]} ×${p.count}`).join(' · ')}` : t('week.noWarnings')}</div>
      <Link className="small" to="/watch">{t('week.open')}</Link>
    </section>
  );
}
