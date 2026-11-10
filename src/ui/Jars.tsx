// Money jars: savings goals that take a share of each day's sales (savings_goals.auto_pct). When the day is closed,
// Kopor suggests what to put in each jar so money for rent, restocking or tax is set aside before it is spent.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { formatMoney } from '@/lib/money';
import { moveSavings } from '@/domain/savings';
import type { Book } from '@/domain/book';
import { salesToday } from './TargetCard';

/** Each jar with what to put aside from today's sales (rounded down to whole Leones). */
export function jarShares(book: Book) {
  const sales = Math.max(0, salesToday(book));
  return book.savingsGoals.filter((g) => !g.deleted && !g.archived && (g.auto_pct ?? 0) > 0)
    .map((g) => ({ goal: g, amount: Math.floor((sales * g.auto_pct!) / 100 / 100) * 100 }))
    .filter((j) => j.amount > 0);
}

export function JarsSheet() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const jars = jarShares(book);
  const [done, setDone] = useState<Set<string>>(new Set());
  const put = async (id: string, amount: number) => {
    const j = jars.find((x) => x.goal.id === id)!;
    try { await moveSavings(ctx, book, j.goal, amount, t('jars.note')); setDone((d) => new Set(d).add(id)); } catch (e) { fail(e); }
  };
  return (
    <div className="stack" data-testid="jars">
      <div className="small muted">{t('jars.help', { sales: formatMoney(Math.max(0, salesToday(book))) })}</div>
      {jars.map(({ goal, amount }) => (
        <div key={goal.id} className="item" data-testid="jar" data-goal={goal.name}>
          <div className="main"><div className="t">{goal.name}</div><div className="s">{t('jars.share', { pct: goal.auto_pct, place: t(`methods.${goal.kept_in}`) })}</div></div>
          <div className="amt num">{formatMoney(amount)}</div>
          {done.has(goal.id) ? <Icon name="check" size={20} className="good" />
            : <button type="button" className="btn sm get" data-testid="jar-put" onClick={() => put(goal.id, amount)}>{t('jars.put')}</button>}
        </div>
      ))}
      <button type="button" className="btn primary block" onClick={async () => {
        for (const j of jars) if (!done.has(j.goal.id)) await put(j.goal.id, j.amount);
        closeSheet(); toast(t('jars.allDone'));
      }}>{t('jars.putAll')}</button>
      <button type="button" className="btn ghost block" onClick={closeSheet}>{t('jars.later')}</button>
    </div>
  );
}
