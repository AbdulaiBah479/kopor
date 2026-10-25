// Daily reminder queue: overdue debts, debts due soon, and unpaid group contributions.
// WhatsApp cannot be sent automatically for free, so Kopor queues them and the user taps "Send next".
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, Money, initials, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { waLink } from '@/lib/phone';
import { overdueContacts, dueSoon } from '@/domain/credit';
import { currentRound, roundStatus, loanReminders } from '@/domain/groups';
import { updateOrg } from '@/domain/org';
import { useReminderText } from './Credit';
import { pushIsOn, pushSupported, remindOwner, stopReminders } from '@/cloud/push';
import { dailyReminderOn, disableDailyReminder, enableDailyReminder, localRemindersSupported, scheduleDailyReminder } from '@/features/dailyReminder';

/** Android app: the daily reminder is made on the phone itself from its records (works offline, no account needed). */
function AppDailyReminder() {
  const { t, i18n } = useTranslation();
  const book = useBook();
  const { toast, fail } = useOverlay();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { dailyReminderOn().then(setOn).catch(() => setOn(false)); }, []);
  return (
    <div className="card row between" data-testid="app-daily">
      <div><b>{t('push.ownerTitle')}</b><div className="small muted">{t('daily.help')}</div></div>
      <button className={`btn sm ${on ? '' : 'primary'}`} disabled={on === null} onClick={async () => {
        try {
          if (on) { await disableDailyReminder(); setOn(false); toast(t('push.off')); return; }
          if (!(await enableDailyReminder())) { toast(t('push.denied'), { tone: 'error' }); return; }
          setOn(true); toast(t('push.on'));
          await scheduleDailyReminder(book, i18n.t);
        } catch (e) { fail(e); }
      }}>{on ? t('push.turnOff') : t('push.turnOn')}</button>
    </div>
  );
}

/** Free daily "to do" notification on this phone (owners and managers): payments to approve, loans due, overdue debts. */
function DailyPush() {
  const { t, i18n } = useTranslation();
  const { ctx, sync } = useApp();
  const { toast, fail } = useOverlay();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { pushIsOn().then(setOn).catch(() => setOn(false)); }, []);
  if (localRemindersSupported()) return <AppDailyReminder />;
  if (!pushSupported()) return <div className="card small muted" data-testid="push-unsupported">{t('push.unsupported')}</div>;
  if (sync.status === 'off') return <div className="card small muted">{t('push.needCloud')}</div>;
  return (
    <div className="card row between" data-testid="daily-push">
      <div><b>{t('push.ownerTitle')}</b><div className="small muted">{t('push.ownerHelp')}</div></div>
      <button className={`btn sm ${on ? '' : 'primary'}`} disabled={on === null} onClick={async () => {
        try {
          if (on) { await stopReminders(); setOn(false); toast(t('push.off')); }
          else { await remindOwner(ctx.orgId, i18n.language); setOn(true); toast(t('push.on')); }
        } catch (e) { fail(e instanceof Error && e.message === 'push.denied' ? new Error(t('push.denied')) : e); }
      }}>{on ? t('push.turnOff') : t('push.turnOn')}</button>
    </div>
  );
}

interface Job { id: string; name: string; phone: string; text: string; amount: number; tag: string; tone: string }

export function Reminders() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { fail } = useOverlay();
  const { fmt } = useDate();
  const remind = useReminderText();
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sms, setSms] = useState(false);
  const { toast } = useOverlay();
  const mayText = can('edit');
  useEffect(() => { if (mayText) import('@/cloud/sms').then((m) => m.smsStatus(ctx.orgId)).then((s) => setSms(s.connected)).catch(() => {}); }, [ctx.orgId, mayText]);
  const text = (j: Job) => import('@/cloud/sms').then((m) => m.smsRemind(ctx.orgId, j.id.slice(1))).then(() => { toast(t('sms.sent', { name: j.name })); setSent(new Set(sent).add(j.id)); }).catch(fail);
  const cc = book.org.country_code;

  const jobs: Job[] = [
    ...overdueContacts(book).map((o) => ({ id: 'o' + o.contact.id, name: o.contact.name, phone: o.contact.phone, text: remind(o.contact), amount: o.balance, tag: `${t('rem.overdue')} · ${fmt(o.since)}`, tone: 'bad' })),
    ...dueSoon(book, book.org.reminder_days || 2).map((d) => ({ id: 's' + d.contact.id, name: d.contact.name, phone: d.contact.phone, text: remind(d.contact), amount: d.balance, tag: `${t('rem.dueSoon')} · ${fmt(d.due)}`, tone: 'warn' })),
    ...loanReminders(book, book.org.reminder_days || 2).map((l) => ({
      id: `l${l.group.id}${l.member.id}`, name: l.member.name, phone: l.member.phone, amount: l.owes, tone: l.overdue ? 'bad' : 'warn',
      tag: `${l.group.name} · ${t(l.overdue ? 'vsla.loanOverdue' : 'vsla.loanDue', { date: fmt(l.due) })}`,
      text: t('vsla.remindMsg', { name: l.member.name, amount: formatMoney(l.owes), group: l.group.name, date: fmt(l.due) }),
    })),
    ...book.groups.flatMap((g) => {
      const r = currentRound(g);
      return roundStatus(book, g, r).unpaid.filter((m) => m.phone).map((m) => ({
        id: `g${g.id}${m.id}`, name: m.name, phone: m.phone, amount: g.amount, tag: `${g.name} · ${t('groups.round', { r })}`, tone: 'warn',
        text: t('groups.remindMsg', { name: m.name, amount: formatMoney(g.amount), group: g.name, round: r, momo: book.org.momo_number ? ` ${book.org.momo_number}.` : '' }),
      }));
    }),
  ].filter((j) => j.phone);
  const next = jobs.find((j) => !sent.has(j.id));
  const send = (j: Job) => { window.open(waLink(j.phone, j.text, cc), '_blank', 'noopener'); setSent(new Set(sent).add(j.id)); };

  return (
    <Page title={t('rem.title')} sub={t('rem.sub')} back="/more">
      {jobs.length > 0 && (
        <div className="card row between">
          <span>{t('rem.sentCount', { sent: sent.size, total: jobs.length })}</span>
          <button className="btn primary sm" disabled={!next} onClick={() => next && send(next)}><Icon name="send" size={16} /> {t('rem.sendNext')}</button>
        </div>
      )}
      <div className="list">
        {jobs.length ? jobs.map((j) => (
          <div key={j.id} className="item">
            <div className="avatar">{initials(j.name)}</div>
            <div className="main"><div className="t">{j.name}</div><div className={`s ${j.tone}`}>{j.tag}</div></div>
            <Money v={j.amount} />
            {sms && /^[os]/.test(j.id) && <button className="tick" aria-label={t('sms.textTo', { name: j.name })} data-testid="sms-remind" onClick={() => text(j)}><Icon name="sms" /></button>}
            <button className={`tick ${sent.has(j.id) ? 'on' : ''}`} aria-label={`WhatsApp ${j.name}`} onClick={() => send(j)}><Icon name={sent.has(j.id) ? 'check' : 'chat'} /></button>
          </div>
        )) : <Empty icon="bell" title={t('rem.none')} />}
      </div>
      {can('reports') && <DailyPush />}
      {can('business') && (
        <Field label={t('rem.autoDays')}>
          <select value={book.org.reminder_days} onChange={(e) => updateOrg(ctx, { reminder_days: Number(e.target.value) }).catch(fail)}>
            {[0, 1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      )}
    </Page>
  );
}
