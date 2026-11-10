// Bills and cash plan (domain/bills.ts): the owner's regular bills, what is due in the next 30 days, and whether the
// money the shop has now covers it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, MoneyInput, Seg, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { EXPENSE_CATEGORIES } from '@/domain/cash';
import type { Book } from '@/domain/book';
import { billsOf, cashPlan, daysTo, payBill, removeBill, saveBill, type Bill, type Due } from '@/domain/bills';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function Bills() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const plan = cashPlan(book);
  const bills = billsOf(book.org);
  return (
    <Page title={t('bills.title')} sub={t('bills.sub')} back="/more"
      fab={can('business') && <button className="fab" data-testid="new-bill" onClick={() => openSheet(t('bills.new'), <BillSheet />)}><Icon name="plus" /> {t('bills.new')}</button>}>
      <PlanSummary plan={plan} />
      <h3 className="section-title">{t('bills.next30')}</h3>
      {plan.dues.length || plan.suppliers.length ? (
        <div className="list" data-testid="bill-dues">
          {plan.dues.map((d) => <DueRow key={`${d.bill.id}-${d.due}`} d={d} />)}
          {plan.suppliers.map((x) => (
            <div key={x.contact.id} className="item">
              <div className="main"><div className="t">{x.contact.name}</div><div className={`s${x.late ? ' bad' : ''}`}>{t('bills.supplier')} · {when(t, x.due!)}</div></div>
              <div className="amt num">{formatMoney(x.owed)}</div>
            </div>
          ))}
        </div>
      ) : <Empty icon="calendar" title={t('bills.noneDue')} text={t('bills.noneHelp')} />}
      {bills.length > 0 && (
        <>
          <h3 className="section-title">{t('bills.all')}</h3>
          <div className="list">
            {bills.map((b) => (
              <button key={b.id} type="button" className="item" style={{ width: '100%', border: 0, textAlign: 'left', font: 'inherit' }} data-testid="bill"
                onClick={() => can('business') && openSheet(b.name, <BillSheet bill={b} />)}>
                <div className="main"><div className="t">{b.name}</div><div className="s">{every(t, b)}</div></div>
                <div className="amt num">{formatMoney(b.amount)}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

const when = (t: (k: string, o?: Record<string, unknown>) => string, due: string) => {
  const n = daysTo(due);
  return n < 0 ? t('bills.late', { n: -n }) : n === 0 ? t('bills.today') : t('bills.inDays', { count: n });
};
const every = (t: (k: string, o?: Record<string, unknown>) => string, b: Bill) =>
  b.every === 'month' ? t('bills.everyMonth', { day: b.day }) : b.every === 'week' ? t('bills.everyWeek', { day: t(`bills.wd.${b.day}`) }) : t('bills.once', { date: b.date });

export function PlanSummary({ plan }: { plan: ReturnType<typeof cashPlan> }) {
  const { t } = useTranslation();
  return (
    <div className="card stack" data-testid="cash-plan">
      <div className="row between"><span className="muted">{t('bills.haveNow')}</span><b className="num">{formatMoney(plan.have)}</b></div>
      <div className="row between"><span className="muted">{t('bills.dueWeek')}</span><b className="num">{formatMoney(plan.dueWeek)}</b></div>
      <div className="row between"><span className="muted">{t('bills.due30')}</span><b className="num">{formatMoney(plan.total)}</b></div>
      {plan.shortWeek > 0 ? <div className="alert bad" data-testid="plan-short"><Icon name="alert" /><div>{t('bills.shortWeek', { amount: formatMoney(plan.shortWeek) })}</div></div>
        : plan.short > 0 ? <div className="alert info"><Icon name="alert" /><div>{t('bills.short30', { amount: formatMoney(plan.short) })}</div></div>
        : plan.total > 0 ? <div className="small good">{t('bills.covered')}</div> : null}
    </div>
  );
}

function DueRow({ d }: { d: Due }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { toast, fail } = useOverlay();
  return (
    <div className="item" data-testid="bill-due" data-bill={d.bill.name}>
      <div className="main"><div className="t">{d.bill.name}</div><div className={`s${d.late ? ' bad' : ''}`}>{when(t, d.due)}</div></div>
      <div className="amt num">{formatMoney(d.bill.amount)}</div>
      {can('business') && d.due <= today() && (
        <button type="button" className="btn sm get" data-testid="pay-bill" onClick={async () => {
          try { await payBill(ctx, book.org, d); toast(t('bills.paid', { name: d.bill.name })); } catch (e) { fail(e); }
        }}>{t('bills.pay')}</button>
      )}
    </div>
  );
}

function BillSheet({ bill }: { bill?: Bill }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ name: bill?.name ?? '', amount: bill?.amount ?? 0, category: bill?.category ?? 'rent', every: bill?.every ?? 'month' as Bill['every'], day: bill?.day ?? 1, date: bill?.date ?? today() });
  return (
    <form className="form" data-testid="bill-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await saveBill(ctx, book.org, f, bill?.id); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <Field label={t('bills.name')}><input name="name" required autoFocus value={f.name} placeholder={t('bills.namePh')} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('common.amount')}><MoneyInput name="amount" big required value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <Field label={t('bills.how')}><Seg value={f.every} onChange={(v) => setF({ ...f, every: v, day: v === 'week' ? 0 : 1 })} options={[['month', t('bills.monthly')], ['week', t('bills.weekly')], ['once', t('bills.oneTime')]]} /></Field>
      {f.every === 'month' && <Field label={t('bills.dayOfMonth')}><input type="number" inputMode="numeric" min={1} max={31} name="day" value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })} /></Field>}
      {f.every === 'week' && <Field label={t('bills.dayOfWeek')}><select name="weekday" value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>{WEEKDAYS.map((d) => <option key={d} value={d}>{t(`bills.wd.${d}`)}</option>)}</select></Field>}
      {f.every === 'once' && <Field label={t('bills.dueDate')}><input type="date" name="date" value={f.date ?? ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
      <Field label={t('cash.category')}><select name="category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</select></Field>
      <button className="btn primary block">{t('common.save')}</button>
      {bill && <button type="button" className="btn ghost block" onClick={async () => { try { await removeBill(ctx, book.org, bill.id); closeSheet(); toast(t('common.deleted')); } catch (err) { fail(err); } }}>{t('common.delete')}</button>}
    </form>
  );
}

/** Home: bills due in the next 7 days, and a warning when the money now does not cover them. */
export function BillsCard({ book }: { book: Book }) {
  const { t } = useTranslation();
  const { fmt } = useDate();
  const plan = cashPlan(book, 7);
  if (!plan.dues.length && !plan.suppliers.length) return null;
  return (
    <Link to="/bills" className={`alert ${plan.shortWeek > 0 ? 'bad' : 'info'}`} data-testid="bills-card">
      <Icon name="calendar" />
      <div><b>{t('bills.soon', { amount: formatMoney(plan.dueWeek) })}</b><br />
        <span className="small">{plan.dues.slice(0, 3).map((d) => `${d.bill.name} ${fmt(d.due)}`).join(' · ')}{plan.shortWeek > 0 ? ` · ${t('bills.shortWeek', { amount: formatMoney(plan.shortWeek) })}` : ''}</span></div>
    </Link>
  );
}
