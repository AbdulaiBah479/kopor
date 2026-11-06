// Mobile money agent book: cash and float per network, today's deposits and withdrawals, commission, and the balance
// check that shows money missing from the drawer or a SIM. Kopor keeps the record; the money stays with the agent.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, MoneyInput, Seg, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { ACCOUNTS, KINDS, NETWORKS, agentState, checkBalances, recordAgent, type Account, type AgentKind, type Network } from '@/domain/agent';

export function Agent() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const s = agentState(book.agentMoves);
  const todays = book.agentMoves.filter((m) => !m.deleted && m.date === today() && m.kind !== 'count').sort((a, b) => b.created_at - a.created_at);
  const missing = ACCOUNTS.map((a) => [a, s.lastCheck[a]] as const).filter(([, c]) => c && c.diff !== 0);
  return (
    <Page title={t('agent.title')} sub={t('agent.sub')} back="/more">
      <div className="card flat small">{t('agent.intro')}</div>

      <div className="grid2" data-testid="agent-balances">
        {ACCOUNTS.map((a) => (
          <div key={a} className="card" data-account={a}>
            <div className="small muted">{t(a === 'cash' ? 'agent.cash' : `methods.${a}`)}{a !== 'cash' && ` · ${t('agent.float')}`}</div>
            <b className={`num${s.balance[a] < 0 ? ' bad' : ''}`} style={{ fontSize: 20 }}>{formatMoney(s.balance[a])}</b>
            {!s.known[a] && <div className="small muted">{t('agent.notChecked')}</div>}
          </div>
        ))}
      </div>

      {missing.map(([a, c]) => (
        <div key={a} className={`alert ${c!.diff < 0 ? 'bad' : 'info'}`} data-testid="agent-diff">
          <Icon name="alert" />
          <div>{t(c!.diff < 0 ? 'agent.short' : 'agent.over', { what: t(a === 'cash' ? 'agent.cash' : `methods.${a}`), amount: formatMoney(Math.abs(c!.diff)), date: fmt(c!.date) })}</div>
        </div>
      ))}

      <div className="card stack">
        <div className="row between"><span className="muted">{t('agent.deposits')}</span><b className="num">{formatMoney(s.day.deposits)}</b></div>
        <div className="row between"><span className="muted">{t('agent.withdrawals')}</span><b className="num">{formatMoney(s.day.withdrawals)}</b></div>
        <div className="row between"><span className="muted">{t('agent.commissionMonth')}</span><b className="num good">{formatMoney(s.commissionMonth)}</b></div>
      </div>

      {can('record') && (
        <div className="btn-row">
          <button className="btn get" data-testid="agent-deposit" onClick={() => openSheet(t('agent.kind.deposit'), <MoveSheet kind="deposit" />)}><Icon name="plus" size={18} /> {t('agent.kind.deposit')}</button>
          <button className="btn primary" data-testid="agent-withdraw" onClick={() => openSheet(t('agent.kind.withdraw'), <MoveSheet kind="withdraw" />)}><Icon name="minus" size={18} /> {t('agent.kind.withdraw')}</button>
          <button className="btn" data-testid="agent-other" onClick={() => openSheet(t('agent.other'), <MoveSheet kind="commission" choose />)}>{t('agent.other')}</button>
          <button className="btn tinted" data-testid="agent-check" onClick={() => openSheet(t('agent.check'), <CheckSheet />)}><Icon name="check" size={18} /> {t('agent.check')}</button>
        </div>
      )}

      <h3 className="section-title">{t('agent.today')}</h3>
      {todays.length ? (
        <div className="list">
          {todays.map((m) => (
            <div key={m.id} className="item" data-testid="agent-row">
              <div className="avatar" style={{ background: m.kind === 'withdraw' ? 'var(--warn-soft)' : 'var(--good-soft)', color: m.kind === 'withdraw' ? 'var(--warn)' : 'var(--good)' }}><Icon name={m.kind === 'withdraw' ? 'minus' : 'plus'} size={18} /></div>
              <div className="main">
                <div className="t">{t(`agent.kind.${m.kind}`)} · {t(`methods.${m.network}`)}</div>
                <div className="s">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{m.phone && ` · ${m.phone}`}{m.note && ` · ${m.note}`}</div>
              </div>
              <div className="amt num">{formatMoney(m.amount)}</div>
            </div>
          ))}
        </div>
      ) : <Empty icon="wallet" title={t('agent.none')} text={t('agent.noneHelp')} />}
    </Page>
  );
}

function MoveSheet({ kind: first, choose = false }: { kind: AgentKind; choose?: boolean }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ kind: first, network: 'orange' as Network, amount: 0, phone: '', note: '' });
  const kinds = choose ? KINDS.filter((k) => k !== 'deposit' && k !== 'withdraw') : [first];
  return (
    <form className="form" data-testid="agent-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const m = await recordAgent(ctx, book.agentMoves, f);
        closeSheet();
        toast(t('common.saved'), { undo: async () => { const { remove } = await import('@/db/repo'); await remove(ctx, 'agent_moves', m.id); } });
      } catch (err) { fail(err); }
    }}>
      {choose && <Seg value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={kinds.map((k) => [k, t(`agent.kind.${k}`)])} />}
      <div className="small muted">{t(`agent.help.${f.kind}`)}</div>
      <Field label={t('agent.network')}><Seg value={f.network} onChange={(network) => setF({ ...f, network })} options={NETWORKS.map((n) => [n, t(`methods.${n}`)])} /></Field>
      <Field label={t('common.amount')}><MoneyInput name="amount" big required autoFocus value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      {(f.kind === 'deposit' || f.kind === 'withdraw') && (
        <Field label={t('agent.customerPhone')}><input type="tel" inputMode="tel" value={f.phone} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      )}
      <Field label={t('common.note')}><input value={f.note} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

function CheckSheet() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const s = agentState(book.agentMoves);
  const [counted, setCounted] = useState<Partial<Record<Account, number>>>({});
  return (
    <form className="form" data-testid="agent-check-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await checkBalances(ctx, counted); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('agent.checkHelp')}</div>
      {ACCOUNTS.map((a) => (
        <Field key={a} label={`${t(a === 'cash' ? 'agent.cashCounted' : `methods.${a}`)}${s.known[a] ? ` (${t('agent.expected', { amount: formatMoney(s.balance[a]) })})` : ''}`}>
          <MoneyInput name={`count_${a}`} value={counted[a] ?? 0} onChange={(v) => setCounted({ ...counted, [a]: v })} />
        </Field>
      ))}
      <button className="btn primary block">{t('agent.saveCheck')}</button>
    </form>
  );
}
