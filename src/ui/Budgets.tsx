// Expense budgets card (Cash screen) and the sheet to set them (domain/budgets.ts).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { Field, MoneyInput } from './widgets';
import { formatMoney } from '@/lib/money';
import { EXPENSE_CATEGORIES } from '@/domain/cash';
import { budgetStatus, saveBudgets } from '@/domain/budgets';

export function BudgetsCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const lines = budgetStatus(book);
  if (!lines.length) return can('business') ? <button type="button" className="btn ghost block" data-testid="set-budgets" onClick={() => openSheet(t('budget.title'), <BudgetsSheet />)}>{t('budget.set')}</button> : null;
  return (
    <section className="card stack" data-testid="budgets" aria-label={t('budget.title')}>
      <div className="row between"><b>{t('budget.title')}</b>
        {can('business') && <button type="button" className="icon-btn" aria-label={t('budget.set')} onClick={() => openSheet(t('budget.title'), <BudgetsSheet />)}><Icon name="edit" size={18} /></button>}</div>
      {lines.map((l) => (
        <div key={l.category} className="stack" style={{ gap: 4 }} data-testid="budget" data-category={l.category} data-state={l.state}>
          <div className="row between small"><span>{t(`categories.${l.category}`)}</span>
            <span className={`num${l.state === 'over' ? ' bad' : ''}`}>{formatMoney(l.spent)} / {formatMoney(l.limit)}</span></div>
          <div className={`meter${l.state === 'over' ? ' bad' : l.state === 'near' ? ' warn' : ''}`} role="progressbar" aria-valuenow={Math.min(100, l.pct)} aria-valuemin={0} aria-valuemax={100} aria-label={t(`categories.${l.category}`)}>
            <i style={{ width: `${Math.min(100, l.pct)}%` }} /></div>
          {l.state !== 'ok' && <div className={`small${l.state === 'over' ? ' bad' : ''}`}>{t(l.state === 'over' ? 'budget.over' : 'budget.near', { amount: formatMoney(Math.abs(l.limit - l.spent)), pct: l.pct })}</div>}
        </div>
      ))}
    </section>
  );
}

function BudgetsSheet() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [limits, setLimits] = useState<Record<string, number>>({ ...((book.org.budgets ?? {}) as Record<string, number>) });
  const cats = EXPENSE_CATEGORIES.filter((c) => c !== 'stock');
  return (
    <form className="form" data-testid="budgets-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await saveBudgets(ctx, limits); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('budget.help')}</div>
      <div className="grid2">
        {cats.map((c) => <Field key={c} label={t(`categories.${c}`)}><MoneyInput name={`budget_${c}`} value={limits[c] ?? 0} onChange={(v) => setLimits({ ...limits, [c]: v })} /></Field>)}
      </div>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}
