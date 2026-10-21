// Savings goals ("cashbox", in the spirit of MiKashBoks' Personal Cashbox): money set aside for rent, restocking,
// school fees... Kopor keeps the record; the money stays where the owner keeps it. Not an expense, so profit is unchanged.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, MoneyInput, Seg, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { addMonths, today } from '@/lib/dates';
import type { SavingsGoal } from '@/db/schema';
import { goalProgress, moveSavings, saveGoal, KEPT_IN } from '@/domain/savings';

export function Savings() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const goals = book.savingsGoals.filter((g) => !g.archived);
  const total = goals.reduce((s, g) => s + goalProgress(book, g).saved, 0);
  return (
    <Page title={t('save.title')} sub={t('save.sub', { amount: formatMoney(total) })} back="/more"
      fab={can('record') && <button className="fab" data-testid="new-goal" onClick={() => openSheet(t('save.new'), <GoalSheet />)}><Icon name="plus" /> {t('save.new')}</button>}>
      <div className="card flat small">{t('save.intro')}</div>
      {goals.length ? (
        <div className="stack">
          {goals.map((g) => <GoalCard key={g.id} goal={g} />)}
        </div>
      ) : <Empty icon="wallet" title={t('save.none')} text={t('save.noneHelp')} />}
    </Page>
  );
}

function GoalCard({ goal }: { goal: SavingsGoal }) {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const p = goalProgress(book, goal);
  return (
    <div className="card stack" data-testid="goal" data-goal={goal.name}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <b style={{ fontSize: 17 }}>{goal.name}</b>
          <div className="small muted">{t(`methods.${goal.kept_in}`)}{goal.due_date ? ` · ${t('save.by', { date: fmt(goal.due_date) })}` : ''}</div>
        </div>
        {can('record') && <button className="icon-btn" aria-label={t('common.edit')} onClick={() => openSheet(t('common.edit'), <GoalSheet goal={goal} />)}><Icon name="edit" size={18} /></button>}
      </div>
      <div className="row between"><b className="num" style={{ fontSize: 22 }}>{formatMoney(p.saved)}</b><span className="small muted num">/ {formatMoney(goal.target)}</span></div>
      <div className="meter" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label={goal.name}><i style={{ width: `${p.pct}%` }} /></div>
      <div className="small">
        {p.reached ? <span className="good">{t('save.reached')}</span>
          : p.perWeek ? t('save.perWeek', { amount: formatMoney(p.perWeek), left: formatMoney(p.left) })
          : t('save.left', { amount: formatMoney(p.left) })}
      </div>
      {can('record') && (
        <div className="btn-row">
          <button className="btn get" data-testid="goal-add" onClick={() => openSheet(t('save.add'), <MoveSheet goal={goal} dir={1} />)}><Icon name="plus" size={18} /> {t('save.add')}</button>
          <button className="btn" disabled={p.saved <= 0} onClick={() => openSheet(t('save.take'), <MoveSheet goal={goal} dir={-1} />)}><Icon name="minus" size={18} /> {t('save.take')}</button>
        </div>
      )}
    </div>
  );
}

function GoalSheet({ goal }: { goal?: SavingsGoal }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ name: goal?.name ?? '', target: goal?.target ?? 0, due_date: goal?.due_date ?? addMonths(today(), 3), kept_in: goal?.kept_in ?? 'cash' });
  return (
    <form className="form" data-testid="goal-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await saveGoal(ctx, f, goal?.id); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <Field label={t('save.name')}><input name="name" required autoFocus value={f.name} placeholder={t('save.namePh')} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('save.target')}><MoneyInput name="target" big required value={f.target} onChange={(target) => setF({ ...f, target })} /></Field>
      <Field label={t('save.dueDate')}><input type="date" value={f.due_date ?? ''} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
      <Field label={t('save.keptIn')}><Seg value={f.kept_in} onChange={(kept_in) => setF({ ...f, kept_in })} options={KEPT_IN.slice(0, 3).map((k) => [k, t(`methods.${k}`)])} /></Field>
      <div className="chips">{KEPT_IN.slice(3).map((k) => <button type="button" key={k} className={`chip${f.kept_in === k ? ' on' : ''}`} onClick={() => setF({ ...f, kept_in: k })}>{t(`methods.${k}`)}</button>)}</div>
      <div className="small muted">{t('save.keptHelp')}</div>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

function MoveSheet({ goal, dir }: { goal: SavingsGoal; dir: 1 | -1 }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  return (
    <form className="form" data-testid="goal-move-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const m = await moveSavings(ctx, book, goal, dir * amount, note);
        closeSheet();
        toast(t(dir > 0 ? 'save.added' : 'save.taken'), { undo: async () => { const { remove } = await import('@/db/repo'); await remove(ctx, 'savings_moves', m.id); } });
      } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t(dir > 0 ? 'save.addHelp' : 'save.takeHelp', { goal: goal.name, place: t(`methods.${goal.kept_in}`) })}</div>
      <Field label={t('common.amount')}><MoneyInput name="amount" big required autoFocus value={amount} onChange={setAmount} /></Field>
      <Field label={t('common.note')}><input value={note} placeholder={t('common.optional')} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className={`btn ${dir > 0 ? 'get' : 'primary'} block`}>{t(dir > 0 ? 'save.add' : 'save.take')}</button>
    </form>
  );
}
