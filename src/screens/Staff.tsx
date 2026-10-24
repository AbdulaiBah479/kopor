// Staff attendance and salaries: today's register (staff tap in and out for themselves, managers mark anyone),
// the month at a glance, and pay (managers and owners only): salary or daily rate, advances, bonuses, deductions,
// paying the salary (a cash-book expense) and a payslip to share on WhatsApp.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, MoneyInput, Seg, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { shareText } from '@/lib/share';
import { today } from '@/lib/dates';
import type { Member, StaffPay } from '@/db/schema';
import { updateOrg } from '@/domain/org';
import { currentPosition, distanceM } from '@/lib/geo';
import { STATUSES, attendanceFlags, dayOf, markDay, monthCounts, monthOf, payFor, recordPay, saveTerms, staffOf, tapIn, tapOut, termsOf, workingDays, type Status } from '@/domain/staff';

type Tab = 'today' | 'month' | 'pay';
const STATUS_CLASS: Record<Status, string> = { present: 'good', late: 'warn', half: 'warn', absent: 'bad', leave: '', off: '' };

export function Staff() {
  const { t } = useTranslation();
  const { can } = useApp();
  const [tab, setTab] = useState<Tab>('today');
  const [month, setMonth] = useState(monthOf(today()));
  return (
    <Page title={t('staff.title')} sub={t('staff.sub')} back="/more">
      <Seg<Tab> value={tab} onChange={setTab} options={[['today', t('staff.today')], ['month', t('staff.month')], ...(can('edit') ? [['pay', t('staff.pay')] as [Tab, string]] : [])]} />
      {tab !== 'today' && <Field label={t('staff.whichMonth')}><input type="month" value={month} max={monthOf(today())} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>}
      {tab === 'today' && <Today />}
      {tab === 'month' && <MonthView month={month} />}
      {tab === 'pay' && can('edit') && <PayView month={month} />}
    </Page>
  );
}

function Today() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can, member: me } = useApp();
  const { toast, fail } = useOverlay();
  const [date, setDate] = useState(today());
  const staff = staffOf(book);
  const mine = me ? dayOf(book, me.id, today()) : undefined;
  const run = (p: Promise<unknown>, msg: string) => p.then(() => toast(msg)).catch(fail);
  const shop = book.org.shop_lat != null && book.org.shop_lng != null ? { lat: book.org.shop_lat, lng: book.org.shop_lng } : null;
  // How far from the shop this phone is (only the distance is saved). Unknown if location is off or refused.
  const arrive = async () => {
    if (!me) return;
    const pos = shop ? await currentPosition() : null;
    const whereM = pos && shop ? distanceM(pos, shop) : null;
    await run(tapIn(ctx, book, me, new Date(), whereM), whereM != null && whereM > 200 ? t('staff.tappedAway', { m: whereM }) : t('staff.tappedIn'));
  };
  const setShop = async () => {
    const pos = await currentPosition(12000);
    if (!pos) return fail(new Error(t('staff.noLocation')));
    await updateOrg(ctx, { shop_lat: Math.round(pos.lat * 1e5) / 1e5, shop_lng: Math.round(pos.lng * 1e5) / 1e5 }).then(() => toast(t('staff.shopSet'))).catch(fail);
  };
  return (
    <>
      {me && can('record') && (
        <div className="card stack" data-testid="tap-card">
          <div className="row between"><b>{t('staff.hi', { name: me.name.split(' ')[0] })}</b>
            {mine && <span className={`badge ${STATUS_CLASS[mine.status]}`}>{t(`staff.st.${mine.status}`)}</span>}</div>
          <div className="small muted">{mine?.time_in ? t('staff.arrived', { time: mine.time_in }) : t('staff.notIn')}{mine?.time_out ? ` · ${t('staff.left', { time: mine.time_out })}` : ''}</div>
          <div className="btn-row">
            {!mine?.time_in && <button className="btn primary" data-testid="tap-in" onClick={arrive}><Icon name="check" size={18} /> {t('staff.tapIn')}</button>}
            {mine?.time_in && !mine.time_out && <button className="btn" data-testid="tap-out" onClick={() => run(tapOut(ctx, book, me), t('staff.tappedOut'))}><Icon name="up" size={18} /> {t('staff.tapOut')}</button>}
          </div>
        </div>
      )}
      {can('team') && (
        <div className="card flat small row between" style={{ gap: 8, flexWrap: 'wrap' }} data-testid="shop-location">
          <span>{shop ? t('staff.shopIsSet') : t('staff.shopNotSet')}</span>
          <button type="button" className="btn sm" onClick={setShop}><Icon name="store" size={16} /> {t(shop ? 'staff.shopReset' : 'staff.shopSetHere')}</button>
        </div>
      )}
      {can('edit') && <Field label={t('staff.date')}><input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>}
      {staff.length > 1 || can('edit') ? (
        <div className="list" data-testid="register">
          {staff.map((m) => {
            const d = dayOf(book, m.id, date);
            const mayMark = can('edit') || (can('record') && me?.id === m.id);
            return (
              <div key={m.id} className="item" data-member={m.name} style={{ flexWrap: 'wrap' }}>
                <div className="main">
                  <div className="t with-badge"><span className="trunc">{m.name}</span>{d ? <span className={`badge ${STATUS_CLASS[d.status]}`}>{t(`staff.st.${d.status}`)}</span> : <span className="badge">{t('staff.notMarked')}</span>}</div>
                  <div className="s">{t(`roles.${m.role}`)}{d?.time_in ? ` · ${t('staff.arrived', { time: d.time_in })}` : ''}{d?.time_out ? ` · ${t('staff.left', { time: d.time_out })}` : ''}
                    {d?.where_m != null && d.where_m <= 200 ? ` · ${t('staff.atShop')}` : ''}</div>
                  {d && can('edit') && attendanceFlags(book, d).map((f) => (
                    <span key={f} className="badge warn" data-testid="att-flag" style={{ marginRight: 4 }}>
                      {f === 'away' ? t('watch.att.awayM', { m: d.where_m }) : f === 'late' ? t('watch.att.lateAt', { time: new Date(d.seen_at!).toTimeString().slice(0, 5) }) : t('watch.att.noPlace')}</span>
                  ))}
                </div>
                {mayMark && can('edit') && (
                  <div className="chips" style={{ width: '100%' }}>
                    {STATUSES.map((s) => (
                      <button key={s} type="button" className={`chip${d?.status === s ? ' on' : ''}`} data-status={s}
                        onClick={() => markDay(ctx, m, date, { status: s }).catch(fail)}>{t(`staff.st.${s}`)}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <Empty icon="users" title={t('staff.noStaff')} text={t('staff.noStaffHelp')} />}
    </>
  );
}

function MonthView({ month }: { month: string }) {
  const { t } = useTranslation();
  const book = useBook();
  const now = today();
  const upTo = month === monthOf(now) ? now : undefined;
  return (
    <div className="list" data-testid="staff-month">
      {staffOf(book).map((m) => {
        const c = monthCounts(book, m.id, month);
        const wd = workingDays(month, termsOf(book, m.id)?.work_days ?? 6, upTo);
        const marked = new Set(book.attendance.filter((a) => a.member_id === m.id && a.date.startsWith(month)).map((a) => a.date));
        const unmarked = wd.filter((d) => !marked.has(d)).length;
        return (
          <div key={m.id} className="item">
            <div className="main">
              <div className="t">{m.name}</div>
              <div className="s">
                {t('staff.counts', { present: c.present + c.late, late: c.late, absent: c.absent, half: c.half, leave: c.leave })}
                {unmarked > 0 && ` · ${t('staff.unmarked', { n: unmarked })}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PayView({ month }: { month: string }) {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const staff = staffOf(book);
  return (
    <>
      <div className="card flat small">{t('staff.payIntro')}</div>
      <div className="stack" data-testid="staff-pay">
        {staff.map((m) => {
          const p = payFor(book, m.id, month);
          const payslip = () => shareText([
            t('staff.slipTitle', { business: book.org.name, month }), `${m.name}`,
            p.terms ? t(p.terms.pay_type === 'daily' ? 'staff.slipDaily' : 'staff.slipMonthly', { amount: formatMoney(p.terms.amount) }) : '',
            t('staff.counts', { present: p.counts.present + p.counts.late, late: p.counts.late, absent: p.counts.absent, half: p.counts.half, leave: p.counts.leave }),
            `${t('staff.earned')}: ${formatMoney(p.earned)}`,
            p.bonus ? `${t('staff.k.bonus')}: +${formatMoney(p.bonus)}` : '', p.deduction ? `${t('staff.k.deduction')}: −${formatMoney(p.deduction)}` : '',
            p.advances ? `${t('staff.k.advance')}: −${formatMoney(p.advances)}` : '',
            `${t('staff.due')}: ${formatMoney(p.due)}`, `${t('staff.paid')}: ${formatMoney(p.paid)}`, `${t('staff.balance')}: ${formatMoney(p.balance)}`,
          ].filter(Boolean).join('\n'), m.phone || undefined);
          return (
            <div key={m.id} className="card stack" data-testid="pay-card" data-member={m.name}>
              <div className="row between">
                <b>{m.name}</b>
                {p.terms ? <span className="small muted">{t(p.terms.pay_type === 'daily' ? 'staff.perDay' : 'staff.perMonth', { amount: formatMoney(p.terms.amount) })}</span>
                  : <span className="badge warn">{t('staff.noTerms')}</span>}
              </div>
              {p.terms && (
                <div className="grid2 small">
                  <div>{t('staff.earned')}<br /><b className="num">{formatMoney(p.earned)}</b></div>
                  <div>{t('staff.k.advance')}<br /><b className="num">{formatMoney(p.advances)}</b></div>
                  <div>{t('staff.due')}<br /><b className="num">{formatMoney(p.due)}</b></div>
                  <div>{t('staff.balance')}<br /><b className={`num ${p.balance > 0 ? 'bad' : 'good'}`} data-testid="pay-balance">{formatMoney(p.balance)}</b></div>
                </div>
              )}
              {p.rows.length > 0 && (
                <div className="small muted">{p.rows.slice().sort((a, b) => a.created_at - b.created_at).map((r) => `${fmt(r.date)} ${t(`staff.k.${r.kind}`)} ${formatMoney(r.amount)}${r.note ? ` (${r.note})` : ''}`).join(' · ')}</div>
              )}
              <div className="btn-row" style={{ flexWrap: 'wrap' }}>
                {can('team') && <button className="btn sm" data-testid="set-pay" onClick={() => openSheet(t('staff.setPay'), <TermsSheet member={m} />)}>{t('staff.setPay')}</button>}
                {p.terms && <button className="btn sm get" data-testid="pay-salary" onClick={() => openSheet(t('staff.paySalary'), <PaySheet member={m} kind="salary" month={month} suggest={Math.max(0, p.balance)} />)}><Icon name="cash" size={16} /> {t('staff.paySalary')}</button>}
                <button className="btn sm" data-testid="give-advance" onClick={() => openSheet(t('staff.k.advance'), <PaySheet member={m} kind="advance" month={month} />)}>{t('staff.k.advance')}</button>
                <button className="btn sm" onClick={() => openSheet(t('staff.k.bonus'), <PaySheet member={m} kind="bonus" month={month} />)}>{t('staff.k.bonus')}</button>
                <button className="btn sm" onClick={() => openSheet(t('staff.k.deduction'), <PaySheet member={m} kind="deduction" month={month} />)}>{t('staff.k.deduction')}</button>
                {p.terms && <button className="btn sm" onClick={payslip}><Icon name="share" size={16} /> {t('staff.payslip')}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TermsSheet({ member }: { member: Member }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const cur = termsOf(book, member.id);
  const [f, setF] = useState({ pay_type: cur?.pay_type ?? 'monthly' as 'monthly' | 'daily', amount: cur?.amount ?? 0, work_days: cur?.work_days ?? 6 });
  return (
    <form className="form" data-testid="terms-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await saveTerms(ctx, book, member, f); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <Field label={t('staff.payType')}><Seg value={f.pay_type} onChange={(pay_type) => setF({ ...f, pay_type })} options={[['monthly', t('staff.monthly')], ['daily', t('staff.daily')]]} /></Field>
      <Field label={t(f.pay_type === 'daily' ? 'staff.dailyRate' : 'staff.salary')}><MoneyInput name="amount" big required value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <Field label={t('staff.workDays')}>
        <select value={f.work_days} onChange={(e) => setF({ ...f, work_days: Number(e.target.value) })}>
          <option value={5}>{t('staff.wd5')}</option><option value={6}>{t('staff.wd6')}</option><option value={7}>{t('staff.wd7')}</option>
        </select>
      </Field>
      <div className="small muted">{t('staff.termsHelp')}</div>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

function PaySheet({ member, kind, month, suggest = 0 }: { member: Member; kind: StaffPay['kind']; month: string; suggest?: number }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [amount, setAmount] = useState(suggest);
  const [method, setMethod] = useState<'cash' | 'orange' | 'afrimoney'>('cash');
  const [note, setNote] = useState('');
  const cash = kind === 'advance' || kind === 'salary';
  return (
    <form className="form" data-testid="pay-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await recordPay(ctx, member, kind, amount, { month, method, note }); closeSheet(); toast(t('staff.recorded')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t(`staff.help.${kind}`, { name: member.name, month })}</div>
      <Field label={t('common.amount')}><MoneyInput name="amount" big required autoFocus value={amount} onChange={setAmount} /></Field>
      {cash && <Field label={t('staff.paidBy')}><Seg value={method} onChange={setMethod} options={[['cash', t('methods.cash')], ['orange', t('methods.orange')], ['afrimoney', t('methods.afrimoney')]]} /></Field>}
      <Field label={t('common.note')}><input value={note} placeholder={t('common.optional')} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className={`btn ${cash ? 'primary' : ''} block`}>{t('common.save')}</button>
    </form>
  );
}
