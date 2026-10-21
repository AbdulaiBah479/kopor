// Member link for a group (osusu, dues or savings & loan): any member opens it on their own phone and sees the group,
// whose turn it is, who has paid this round, and their own savings and loan, always up to date. Names only, never
// phone numbers. Data comes from a SECURITY DEFINER function that answers only for the group's secret token.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '@/cloud/supabase';
import { formatMoney, setCurrencySymbol } from '@/lib/money';
import { useDate } from '@/ui/widgets';
import { Icon } from '@/ui/Icon';
import { pushSupported, remindMember } from '@/cloud/push';
import { LoadFailed } from './PublicStatement';
import { currentRound, roundDate } from '@/domain/groups';
import type { Group } from '@/db/schema';

interface PubMember { id: string; name: string; saved: number; rounds: number[]; owes: number; next_due: string | null }
interface PubGroup {
  name: string; kind: Group['kind']; amount: number; frequency: Group['frequency']; start_date: string; target: number | null; loan_interest: number;
  payouts: Record<string, string>; org_name: string; currency: string; momo_number: string;
  members: PubMember[]; saved_total: number; lent_out: number; interest_earned: number;
}

export function PublicGroup() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { fmt } = useDate();
  const [g, setG] = useState<PubGroup | null | undefined | 'error'>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    getSupabase().then(async (sb) => {
      if (!sb) return setG(null);
      const { data, error } = await sb.rpc('public_group', { token }).abortSignal(AbortSignal.timeout(15_000));
      if (error) return setG('error');
      if (data) setCurrencySymbol((data as PubGroup).currency);
      setG((data as PubGroup | null) ?? null);
    }).catch(() => setG('error'));
  }, [token, attempt]);
  if (g === undefined) return <div className="boot"><div className="boot-logo">K</div></div>;
  if (g === 'error') return <LoadFailed onRetry={() => { setG(undefined); setAttempt(attempt + 1); }} />;
  if (!g) return <div className="shell"><div className="content"><div className="empty" data-testid="group-missing"><b>{t('vsla.notFound')}</b></div></div></div>;

  // Rounds follow the same calendar as in the organiser's app.
  const shape = { kind: g.kind, members: g.members, frequency: g.frequency, start_date: g.start_date } as unknown as Group;
  const r = currentRound(shape);
  const collector = g.kind === 'osusu' && g.members.length ? g.members[(r - 1) % g.members.length] : null;
  const paid = g.members.filter((m) => m.rounds.includes(r)).length;
  const inBox = Number(g.saved_total) - Number(g.lent_out) + 0;
  return (
    <div className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 20 }}>
        <div className="doc" data-testid="public-group">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div><h2>{g.name}</h2><div className="small">{g.org_name}</div></div>
            <div style={{ textAlign: 'right' }} className="small">{formatMoney(Number(g.amount))} {t(`groups.${g.frequency}`)}</div>
          </div>
          <div className="card flat" style={{ marginTop: 14 }}>
            <b>{t('groups.round', { r })}</b> · {fmt(roundDate(shape, r))}
            <div className="small">{t('groups.paidCount', { paid, total: g.members.length })}{collector ? ` · ${t('groups.collects')}: ${collector.name}` : ''}</div>
            {g.kind === 'savings' && <div className="small" style={{ marginTop: 6 }}>{t('vsla.publicPot', { saved: formatMoney(Number(g.saved_total)), lent: formatMoney(Math.max(0, Number(g.lent_out))), box: formatMoney(Math.max(0, inBox)), pct: g.loan_interest })}</div>}
            {g.target ? <div className="small" style={{ marginTop: 6 }}>{t('vsla.toTarget', { target: formatMoney(Number(g.target)) })}: {Math.min(100, Math.round((Number(g.saved_total) / Number(g.target)) * 100))}%</div> : null}
          </div>
          <table>
            <thead><tr><th>{t('vsla.member')}</th><th className="r">{t('vsla.saved')}</th>{g.kind === 'savings' && <th className="r">{t('vsla.owes')}</th>}<th className="r">{t('groups.round', { r })}</th></tr></thead>
            <tbody>
              {g.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}{collector?.id === m.id ? ` · ${t('groups.collects')}` : ''}</td>
                  <td className="r num">{formatMoney(Number(m.saved))}</td>
                  {g.kind === 'savings' && <td className="r num">{Number(m.owes) > 0 ? `${formatMoney(Number(m.owes))}${m.next_due ? ` (${fmt(m.next_due)})` : ''}` : '—'}</td>}
                  <td className="r">{m.rounds.includes(r) ? '✅' : '⏳'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.momo_number && <div className="small"><b>{t('stmt.payTo')}:</b> {g.momo_number}</div>}
          <div className="foot">{t('vsla.publicNote')} · {t('inv.generated')}</div>
        </div>
        <IPaid token={token ?? ''} group={g} round={r} />
        <RemindMe token={token ?? ''} group={g} />
      </div>
    </div>
  );
}

/** "Remind me": free notifications on this phone when this member's payment or loan repayment is due. */
function RemindMe({ token, group: g }: { token: string; group: PubGroup }) {
  const { t, i18n } = useTranslation();
  const [member, setMember] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'on' | 'error'>('idle');
  const [err, setErr] = useState('');
  if (!pushSupported()) return null;
  if (state === 'on') return <div className="card small" data-testid="remind-on"><Icon name="bell" size={16} /> {t('push.memberOn')}</div>;
  return (
    <div className="card stack" data-testid="remind-me">
      <b><Icon name="bell" size={18} /> {t('push.memberTitle')}</b>
      <div className="small muted">{t('push.memberHelp')}</div>
      <select aria-label={t('claims.who')} value={member} onChange={(e) => setMember(e.target.value)}>
        <option value="" disabled>{t('claims.pick')}</option>
        {g.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {state === 'error' && <div className="alert small" role="alert"><Icon name="alert" /><div>{err}</div></div>}
      <button className="btn block" disabled={!member || state === 'busy'} onClick={async () => {
        setState('busy');
        try { await remindMember(token, member, i18n.language); setState('on'); }
        catch (e) { setState('error'); setErr(t(e instanceof Error && e.message === 'push.denied' ? 'push.denied' : 'public.loadFail')); }
      }}>{t('push.remindMe')}</button>
    </div>
  );
}

/**
 * "I've paid": a member tells the treasurer about a payment (with the mobile money transaction ID if they have one).
 * It is only a request: it counts after the treasurer approves it in Kopor.
 */
function IPaid({ token, group: g, round }: { token: string; group: PubGroup; round: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ member: '', kind: 'contribution' as 'contribution' | 'repay', amount: Number(g.amount) / 100, method: 'orange', ref: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');
  const owes = Number(g.members.find((m) => m.id === f.member)?.owes ?? 0);
  if (state === 'sent') return <div className="card stack" data-testid="claim-sent"><b>{t('claims.sentTitle')}</b><div className="small">{t('claims.sentHelp')}</div></div>;
  if (!open) return <button className="btn primary block" data-testid="i-paid" onClick={() => setOpen(true)}><Icon name="check" size={18} /> {t('claims.iPaid')}</button>;
  return (
    <form className="card stack" data-testid="claim-form" onSubmit={async (e) => {
      e.preventDefault();
      setState('sending'); setErr('');
      try {
        const sb = await getSupabase();
        if (!sb) throw new Error('offline');
        const { error } = await sb.rpc('submit_group_claim', {
          token, member: f.member, kind: f.kind, amount: Math.round(f.amount * 100), round, method: f.method, ref: f.ref.trim(), note: '',
        }).abortSignal(AbortSignal.timeout(15_000));
        if (error) throw new Error(error.message);
        setState('sent');
      } catch (ex) {
        setState('error');
        setErr(/too many/i.test(ex instanceof Error ? ex.message : '') ? t('claims.tooMany') : t('public.loadFail'));
      }
    }}>
      <b>{t('claims.iPaid')}</b>
      <div className="small muted">{t('claims.formHelp')}</div>
      <label className="small" htmlFor="claim-member">{t('claims.who')}</label>
      <select id="claim-member" required value={f.member} onChange={(e) => setF({ ...f, member: e.target.value })}>
        <option value="" disabled>{t('claims.pick')}</option>
        {g.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {g.kind === 'savings' && owes > 0 && (
        <select aria-label={t('claims.what')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'contribution' | 'repay', amount: e.target.value === 'repay' ? owes / 100 : Number(g.amount) / 100 })}>
          <option value="contribution">{t('groups.round', { r: round })}</option><option value="repay">{t('claims.repay')}</option>
        </select>
      )}
      <label className="small" htmlFor="claim-amount">{t('common.amount')} (Le)</label>
      <input id="claim-amount" className="input" type="number" inputMode="decimal" min="1" step="any" required value={f.amount || ''} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} />
      <label className="small" htmlFor="claim-method">{t('claims.how')}</label>
      <select id="claim-method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
        {['orange', 'afrimoney', 'qmoney', 'cash', 'bank'].map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}
      </select>
      {f.method !== 'cash' && <input className="input" aria-label={t('claims.ref')} placeholder={t('claims.ref')} maxLength={60} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />}
      {state === 'error' && <div className="alert small" role="alert"><Icon name="alert" /><div>{err}</div></div>}
      <button className="btn primary block" disabled={state === 'sending' || !f.member}>{t('claims.send')}</button>
    </form>
  );
}
