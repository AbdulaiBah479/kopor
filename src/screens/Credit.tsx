import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Avatar, ContactPick, Empty, Field, Money, MoneyInput, Search, Seg, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today, addDays } from '@/lib/dates';
import { waLink, smsLink, telLink } from '@/lib/phone';
import { update, remove, atomic } from '@/db/repo';
import type { Contact, LedgerEntry } from '@/db/schema';
import { balances, creditTotals, overdueSince, ensureContact, addEntry, removeEntry } from '@/domain/credit';
import { isOwnRecent } from '@/domain/cash';

/** Oldest first (like a chat), with the running balance after each entry and a date marker on each new day. */
function ledgerRows(newestFirst: LedgerEntry[]) {
  let running = 0, prev = '';
  return [...newestFirst].reverse().map((e) => {
    running += e.type === 'gave' ? e.amount : -e.amount;
    const newDay = e.date !== prev;
    prev = e.date;
    return { e, running, newDay };
  });
}
import { findByName, AppError } from '@/domain/book';
/**
 * Confirmation the customer receives on WhatsApp after an entry ("You took Le 500, your balance is Le 1,500"),
 * the trust feature of the best credit-book apps: no arguments later about what was owed.
 * Returns a toast share action, or undefined when the contact has no phone number.
 */
export function useEntryConfirm() {
  const { t } = useTranslation();
  const book = useBook();
  return (c: Pick<Contact, 'id' | 'name' | 'phone'>, type: 'gave' | 'got', amount: number, note = '') => {
    if (!c.phone) return undefined;
    const before = balances(book.ledger).get(c.id) ?? 0;
    const after = before + (type === 'gave' ? amount : -amount);
    const text = t(type === 'gave' ? 'credit.confirmGave' : 'credit.confirmGot', {
      name: c.name.split(' ')[0], business: book.org.name, amount: formatMoney(amount),
      note: note.trim() ? ` (${note.trim()})` : '', balance: formatMoney(Math.max(0, after)),
    });
    return { label: t('credit.sendConfirm'), href: waLink(c.phone, text, book.org.country_code) };
  };
}
import { createUssdCode } from '@/cloud/payments';

/** Polite reminder message in the current language. */
export function useReminderText() {
  const { t } = useTranslation();
  const book = useBook();
  const { fmt } = useDate();
  return (c: Contact) => {
    const bal = balances(book.ledger).get(c.id) ?? 0;
    const due = book.ledger.filter((e) => e.contact_id === c.id && e.type === 'gave' && e.due_date).map((e) => e.due_date!).sort()[0];
    return t('credit.reminderMsg', {
      name: c.name, business: book.org.name, amount: formatMoney(bal),
      due: due ? t('credit.reminderDue', { date: fmt(due) }) : '', momo: book.org.momo_number ? t('credit.reminderMomo', { momo: book.org.momo_number }) : '',
    });
  };
}

export function CreditList() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const [filter, setFilter] = useState<'all' | 'overdue'>('all');
  const [q, setQ] = useState('');
  const bal = useMemo(() => balances(book.ledger), [book.ledger]);
  const totals = creditTotals(book);
  const lastDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of book.ledger) if ((m.get(e.contact_id) ?? '') < e.date) m.set(e.contact_id, e.date);
    return m;
  }, [book.ledger]);

  const rows = book.contacts
    .map((c) => ({ c, b: bal.get(c.id) ?? 0, od: overdueSince(book.ledger, c.id) }))
    .filter((r) => (filter === 'overdue' ? !!r.od : true))
    .filter((r) => !q || `${r.c.name} ${r.c.phone}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(!!b.od) - Number(!!a.od) || Math.abs(b.b) - Math.abs(a.b));

  return (
    <Page guide="credit" title={t('credit.title')} sub={t('credit.sub', { count: book.contacts.length })}
      fab={can('record') && <button className="fab" onClick={() => openSheet(t('credit.addEntry'), <NewCreditSheet />)}><Icon name="plus" /> {t('credit.addEntry')}</button>}>
      <div className="grid2">
        <div className="stat"><div className="k">{t('credit.willGet')}</div><div className="v"><Money v={totals.get} className="good" /></div></div>
        <div className="stat"><div className="k">{t('credit.willGive')}</div><div className="v"><Money v={totals.give} className="bad" /></div></div>
      </div>
      <Seg value={filter} onChange={setFilter} options={[['all', t('common.all')], ['overdue', t('credit.overdue')]]} />
      <Search value={q} onChange={setQ} placeholder={t('credit.searchPh')} />
      <div className="list" id="contacts">
        {rows.length ? rows.map(({ c, b, od }) => (
          <Link key={c.id} className="item" to={`/credit/${c.id}`}>
            <Avatar name={c.name} />
            <div className="main">
              <div className="t with-badge"><span className="trunc">{c.name}</span> {od && <span className="badge bad">{t('credit.overdue')}</span>}{c.kind === 'supplier' && <span className="badge"> {t('credit.supplier')}</span>}</div>
              <div className="s">{lastDate.get(c.id) ? fmt(lastDate.get(c.id)) : t('credit.noEntries')}{c.phone && ` · ${c.phone}`}</div>
            </div>
            <div className={`amt num ${b > 0 ? 'good' : b < 0 ? 'bad' : ''}`}>{formatMoney(Math.abs(b))}<small>{b > 0 ? t('credit.willGet') : b < 0 ? t('credit.willGive') : t('credit.settled')}</small></div>
          </Link>
        )) : filter === 'overdue' ? <Empty icon="book" title={t('credit.noOverdue')} text={t('credit.noOverdueHelp')} /> : <Empty icon="book" title={t('credit.noContacts')} text={t('credit.noContactsHelp')} />}
      </div>
    </Page>
  );
}

export function ContactDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const book = useBook();
  const { can, ctx } = useApp();
  const { openSheet, toast, fail } = useOverlay();
  const { fmt } = useDate();
  const remind = useReminderText();
  const c = book.contacts.find((x) => x.id === id);
  if (!c) return <Page title={t('err.notFound')} back="/credit"><Empty icon="book" title={t('err.notFound')} /></Page>;
  const b = balances(book.ledger).get(c.id) ?? 0;
  const od = overdueSince(book.ledger, c.id);
  const cc = book.org.country_code;
  const entries = book.ledger.filter((e) => e.contact_id === c.id).sort((x, y) => y.date.localeCompare(x.date) || y.created_at - x.created_at);
  const statement = `${t('credit.statementTitle', { name: c.name, business: book.org.name })}\n\n${[...entries].reverse()
    .map((e) => `${fmt(e.date)}: ${e.type === 'gave' ? t('credit.creditGiven') : t('credit.paymentReceived')} ${formatMoney(e.amount)}${e.note ? ` (${e.note})` : ''}`).join('\n')}\n\n${t('credit.balance')}: ${formatMoney(b)}`;

  const requestPay = async () => {
    try {
      const r = await createUssdCode(ctx.orgId, { amount: b, name: `${book.org.name}`.slice(0, 60), phone: c.phone });
      openSheet(t('inv.ussd'), <div className="stack"><div className="code-box">{r.ussdCode}</div>
        <a className="btn get block" target="_blank" rel="noopener noreferrer" href={waLink(c.phone, `${remind(c)}\n\nUSSD: ${r.ussdCode}`, cc)}><Icon name="chat" size={18} /> {t('common.whatsapp')}</a></div>);
    } catch (e) { fail(e); }
  };

  return (
    <Page title={c.name} sub={c.phone || '—'} back="/credit"
      right={can('edit') && <button className="icon-btn" aria-label={t('credit.editContact')} onClick={() => openSheet(t('credit.editContact'), <EditContactSheet contact={c} />)}><Icon name="edit" /></button>}
      after={can('record') && (
        <div className="sticky-actions"><div className="btn-row">
          <button className="btn give" onClick={() => openSheet(`${t('credit.youGave')} · ${c.name}`, <EntrySheet contact={c} type="gave" />)}>{t('credit.youGave')} <Icon name="up" size={18} /></button>
          <button className="btn get" onClick={() => openSheet(`${t('credit.youGot')} · ${c.name}`, <EntrySheet contact={c} type="got" />)}>{t('credit.youGot')} <Icon name="down" size={18} /></button>
        </div></div>
      )}>
      <div className="card balance">
        <div className="muted small">{b > 0 ? t('credit.willGet') : b < 0 ? t('credit.willGive') : t('credit.settled')}</div>
        <div className={`big num ${b > 0 ? 'good' : b < 0 ? 'bad' : ''}`}>{formatMoney(Math.abs(b))}</div>
        {od && <span className="badge bad">{t('credit.overdue')} · {fmt(od)}</span>}
      </div>
      <div className="contact-actions">
        <a href={waLink(c.phone, remind(c), cc)} target="_blank" rel="noopener noreferrer"><Icon name="chat" />{t('credit.remind')}</a>
        <a href={smsLink(c.phone, remind(c), cc)}><Icon name="sms" />{t('common.sms')}</a>
        <a href={c.phone ? telLink(c.phone, cc) : undefined} aria-disabled={!c.phone}><Icon name="phone" />{t('common.call')}</a>
        <a href={waLink(c.phone, statement, cc)} target="_blank" rel="noopener noreferrer"><Icon name="share" />{t('credit.statement')}</a>
      </div>
      {b > 0 && can('payments') && <button className="btn block ghost" onClick={requestPay}><Icon name="phone" size={18} /> {t('credit.requestPay')} (USSD)</button>}
      {/* Chat-style ledger: credit given on the right, payments received on the left, running balance under each. */}
      <div className="flex flex-col gap-2" aria-label={t('credit.title')}>
        {entries.length ? ledgerRows(entries).map(({ e, running, newDay }) => (
          <div key={e.id} className="flex flex-col gap-2">
            {newDay && <div className="self-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{fmt(e.date)}</div>}
            <button type="button" data-entry={e.type}
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-left shadow-sm transition active:scale-[.98] ${e.type === 'gave' ? 'self-end rounded-br-md bg-danger-soft' : 'self-start rounded-bl-md bg-primary-soft'}`}
              onClick={() => openSheet(t('common.edit'), (
                <div className="stack">
                  <div className="card flat"><b className="num">{formatMoney(e.amount)}</b> · {e.type === 'gave' ? t('credit.youGave') : t('credit.youGot')}<div className="muted small">{fmt(e.date)} {e.note}</div></div>
                  {(can('edit') || isOwnRecent(ctx, e)) && <DeleteButton onDelete={async () => { await removeEntry(ctx, e.id); toast(t('common.deleted')); }} />}
                </div>
              ))}>
              <div className={`num text-xl font-extrabold ${e.type === 'gave' ? 'text-danger' : 'text-primary'}`}>{e.type === 'gave' ? '' : '+'}{formatMoney(e.amount)}</div>
              <div className="text-[13px] font-semibold">{e.note || (e.type === 'gave' ? t('credit.creditGiven') : t('credit.paymentReceived'))}</div>
              <div className="mt-1 flex gap-2 text-[11.5px] text-muted-foreground">
                <span>{t('credit.balance')}: <b className="num">{formatMoney(running)}</b></span>
                {e.due_date && e.type === 'gave' && <span>· {t('credit.due', { date: fmt(e.due_date) })}</span>}
              </div>
            </button>
          </div>
        )) : <Empty icon="book" title={t('credit.noEntries')} />}
      </div>
      <div style={{ height: 64 }} />
    </Page>
  );
}

export function DeleteButton({ onDelete, label }: { onDelete: () => Promise<void>; label?: string }) {
  const { t } = useTranslation();
  const { closeSheet, fail } = useOverlay();
  return (
    <button className="btn danger block" onClick={async () => {
      if (!confirm(t('common.confirm'))) return;
      try { await onDelete(); closeSheet(); } catch (e) { fail(e); }
    }}><Icon name="trash" size={18} /> {label ?? t('common.delete')}</button>
  );
}

function EntryFields({ type, f, setF }: { type: 'gave' | 'got'; f: EntryForm; setF: (f: EntryForm) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t('common.amount')}><MoneyInput big autoFocus required value={f.amount} onChange={(amount) => setF({ ...f, amount })} name="amount" /></Field>
      <Field label={t('common.note')}><input value={f.note} placeholder={t('credit.notePh')} onChange={(e) => setF({ ...f, note: e.target.value })} name="note" /></Field>
      <div className="grid2">
        <Field label={t('common.date')}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {type === 'gave' ? <Field label={t('common.dueDate')}><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field> : <div />}
      </div>
    </>
  );
}
interface EntryForm { amount: number; note: string; date: string; due: string }
const newEntry = (): EntryForm => ({ amount: 0, note: '', date: today(), due: addDays(today(), 14) });

function EntrySheet({ contact, type }: { contact: Contact; type: 'gave' | 'got' }) {
  const { t } = useTranslation();
  const confirm = useEntryConfirm();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState(newEntry);
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const share = confirm(contact, type, f.amount, f.note);
        const entry = await addEntry(ctx, { contactId: contact.id, type, amount: f.amount, note: f.note, date: f.date, dueDate: f.due });
        closeSheet(); toast(t('common.saved'), { undo: () => removeEntry(ctx, entry.id), share });
      } catch (err) { fail(err); }
    }}>
      <EntryFields type={type} f={f} setF={setF} />
      <button className={`btn ${type === 'gave' ? 'give' : 'get'} block`}>{t('common.save')}</button>
    </form>
  );
}

export function NewCreditSheet({ name = '', type: initial = 'gave', amount = 0, note = '' }: { name?: string; type?: 'gave' | 'got'; amount?: number; note?: string }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const nav = useNavigate();
  const confirm = useEntryConfirm();
  const [who, setWho] = useState({ name, phone: '' });
  const [type, setType] = useState<'gave' | 'got'>(initial);
  const [f, setF] = useState({ ...newEntry(), amount, note });
  return (
    <form className="form" data-testid="new-credit" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const [c, entry] = await atomic(async () => {
          const c = await ensureContact(ctx, who.name, who.phone);
          return [c, await addEntry(ctx, { contactId: c.id, type, amount: f.amount, note: f.note, date: f.date, dueDate: f.due })] as const;
        });
        // ook is the snapshot from before this save, so the confirmation's starting balance is right.
        const share = confirm({ ...c, phone: c.phone || who.phone }, type, f.amount, f.note);
        closeSheet(); toast(t('common.saved'), { undo: () => removeEntry(ctx, entry.id), share }); nav(`/credit/${c.id}`);
      } catch (err) { fail(err); }
    }}>
      <Field label={t('credit.who')}><input name="name" list="dl-contacts" required autoComplete="off" value={who.name} placeholder="e.g. Aminata Kamara"
        onChange={(e) => setWho({ ...who, name: e.target.value })} /></Field>
      <datalist id="dl-contacts">{book.contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <ContactPick onPick={(p) => setWho({ name: p.name, phone: p.phone })} />
      {!findByName(book.contacts, who.name) && (
        <Field label={t('credit.phoneHelp')}><input type="tel" inputMode="tel" value={who.phone} placeholder="076 123 456" onChange={(e) => setWho({ ...who, phone: e.target.value })} /></Field>
      )}
      <Seg value={type} onChange={setType} options={[['gave', t('credit.gaveHelp')], ['got', t('credit.gotHelp')]]} />
      <EntryFields type={type} f={f} setF={setF} />
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

function EditContactSheet({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, fail } = useOverlay();
  const nav = useNavigate();
  const [f, setF] = useState({ name: contact.name, phone: contact.phone, kind: contact.kind });
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const clash = findByName(book.contacts, f.name);
        if (clash && clash.id !== contact.id) throw new AppError('err.contactExists');
        await update(ctx, 'contacts', contact.id, { name: f.name.trim(), phone: f.phone.trim(), kind: f.kind }, `Edited ${f.name}`);
        closeSheet();
      } catch (err) { fail(err); }
    }}>
      <Field label={t('common.name')}><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('common.phone')}><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label={t('credit.kind')}>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Contact['kind'] })}>
          <option value="customer">{t('credit.customer')}</option><option value="supplier">{t('credit.supplier')}</option>
        </select>
      </Field>
      <button className="btn primary block">{t('common.save')}</button>
      <DeleteButton label={t('credit.deleteContact')} onDelete={async () => {
        await atomic(async () => {
          for (const en of book.ledger.filter((x) => x.contact_id === contact.id)) await remove(ctx, 'ledger', en.id);
          await remove(ctx, 'contacts', contact.id, `Deleted ${contact.name}`);
        });
        nav('/credit');
      }} />
    </form>
  );
}
