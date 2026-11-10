// Pay small-small (domain/layaway.ts): goods kept for customers who pay in parts.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, MoneyInput, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { addDays, today } from '@/lib/dates';
import { waLink } from '@/lib/phone';
import type { Layaway as Plan } from '@/db/schema';
import { cancelLayaway, collectLayaway, openPlans, payLayaway, progress, startLayaway } from '@/domain/layaway';

export function Layaway() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const plans = openPlans(book);
  const held = plans.reduce((s, p) => s + progress(book, p).paid, 0);
  return (
    <Page title={t('lay.title')} sub={t('lay.sub', { n: plans.length, amount: formatMoney(held) })} back="/more"
      fab={can('record') && <button className="fab" data-testid="new-layaway" onClick={() => openSheet(t('lay.new'), <NewPlan />)}><Icon name="plus" /> {t('lay.new')}</button>}>
      <div className="card flat small">{t('lay.intro')}</div>
      {plans.length ? <div className="stack">{plans.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
        : <Empty icon="box" title={t('lay.none')} text={t('lay.noneHelp')} />}
    </Page>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { openSheet, toast, fail } = useOverlay();
  const { fmt } = useDate();
  const p = progress(book, plan);
  const c = book.contacts.find((x) => x.id === plan.contact_id);
  return (
    <div className="card stack" data-testid="layaway" data-item={plan.item}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div><b style={{ fontSize: 17 }}>{plan.item}{plan.qty !== 1 ? ` × ${plan.qty}` : ''}</b><div className="small muted">{c?.name ?? '—'}{plan.due_date ? ` · ${t('lay.by', { date: fmt(plan.due_date) })}` : ''}</div></div>
        {p.late && <span className="badge bad">{t('lay.late')}</span>}
      </div>
      <div className="row between"><b className="num" style={{ fontSize: 20 }}>{formatMoney(p.paid)}</b><span className="small muted num">/ {formatMoney(plan.total)}</span></div>
      <div className="meter" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label={plan.item}><i style={{ width: `${p.pct}%` }} /></div>
      <div className={`small${p.done ? ' good' : ''}`}>{p.done ? t('lay.ready') : t('lay.left', { amount: formatMoney(p.left) })}</div>
      {can('record') && (
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          {!p.done && <button className="btn get sm" data-testid="lay-pay" onClick={() => openSheet(t('lay.pay'), <PaySheet plan={plan} />)}><Icon name="plus" size={16} /> {t('lay.pay')}</button>}
          {p.done && <button className="btn primary sm" data-testid="lay-collect" onClick={async () => {
            try { await collectLayaway(ctx, book, plan); toast(t('lay.collected', { item: plan.item })); } catch (e) { fail(e); }
          }}><Icon name="check" size={16} /> {t('lay.collect')}</button>}
          {can('returns') && <button className="btn ghost sm" onClick={async () => {
            if (!confirm(t('lay.cancelAsk', { amount: formatMoney(p.paid) }))) return;
            try { await cancelLayaway(ctx, book, plan); toast(t('lay.cancelled')); } catch (e) { fail(e); }
          }}>{t('lay.cancel')}</button>}
        </div>
      )}
    </div>
  );
}

function PaySheet({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const left = progress(book, plan).left;
  const [amount, setAmount] = useState(0);
  const c = book.contacts.find((x) => x.id === plan.contact_id);
  return (
    <form className="form" data-testid="lay-pay-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await payLayaway(ctx, plan, amount, left);
        closeSheet();
        const nowPaid = progress(book, plan).paid + amount;
        const msg = t('lay.receipt', { name: c?.name.split(' ')[0] ?? '', amount: formatMoney(amount), item: plan.item, paid: formatMoney(nowPaid), total: formatMoney(plan.total), left: formatMoney(Math.max(0, plan.total - nowPaid)), shop: book.org.name });
        toast(t('lay.paid'), c?.phone ? { share: { label: t('lay.sendReceipt'), href: waLink(c.phone, msg, book.org.country_code) } } : undefined);
      } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('lay.leftNow', { amount: formatMoney(left), item: plan.item })}</div>
      <Field label={t('common.amount')}><MoneyInput name="amount" big required autoFocus value={amount} onChange={setAmount} /></Field>
      <div className="small muted">{t('lay.cashNote')}</div>
      <button className="btn get block">{t('common.save')}</button>
    </form>
  );
}

function NewPlan() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ customer: '', phone: '', productId: '', item: '', qty: 1, total: 0, first: 0, due: addDays(today(), 30) });
  const products = [...book.products].filter((p) => !p.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const pick = (id: string) => {
    const p = products.find((x) => x.id === id);
    setF({ ...f, productId: id, item: p?.name ?? f.item, total: p ? Math.round(p.price * f.qty) : f.total });
  };
  return (
    <form className="form" data-testid="lay-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await startLayaway(ctx, { customer: f.customer, phone: f.phone, item: f.item, productId: f.productId || null, qty: f.qty, total: f.total, first: f.first, dueDate: f.due });
        closeSheet(); toast(t('common.saved'));
      } catch (err) { fail(err); }
    }}>
      <Field label={t('lay.customer')}>
        <input name="customer" required list="lay-contacts" value={f.customer} autoComplete="off" onChange={(e) => {
          const c = book.contacts.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
          setF({ ...f, customer: e.target.value, phone: c?.phone ?? f.phone });
        }} />
        <datalist id="lay-contacts">{book.contacts.filter((c) => c.kind !== 'supplier').map((c) => <option key={c.id} value={c.name} />)}</datalist>
      </Field>
      <Field label={t('lay.phone')}><input name="phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      {products.length > 0 && (
        <Field label={t('lay.fromStock')}>
          <select name="product" value={f.productId} onChange={(e) => pick(e.target.value)}>
            <option value="">{t('lay.notInStock')}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price)}</option>)}
          </select>
        </Field>
      )}
      <Field label={t('lay.item')}><input name="item" required value={f.item} placeholder={t('lay.itemPh')} onChange={(e) => setF({ ...f, item: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t('lay.qty')}><input name="qty" type="number" inputMode="decimal" min={1} value={f.qty} onChange={(e) => {
          const qty = Math.max(1, Number(e.target.value) || 1); const p = products.find((x) => x.id === f.productId);
          setF({ ...f, qty, total: p ? Math.round(p.price * qty) : f.total });
        }} /></Field>
        <Field label={t('lay.total')}><MoneyInput name="total" required value={f.total} onChange={(total) => setF({ ...f, total })} /></Field>
      </div>
      <Field label={t('lay.first')}><MoneyInput name="first" value={f.first} onChange={(first) => setF({ ...f, first })} /></Field>
      <Field label={t('lay.due')}><input type="date" name="due" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}
