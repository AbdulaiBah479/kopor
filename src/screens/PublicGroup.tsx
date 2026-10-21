// Member link for a group (osusu, dues or savings & loan): any member opens it on their own phone and sees the group,
// whose turn it is, who has paid this round, and their own savings and loan, always up to date. Names only, never
// phone numbers. Data comes from a SECURITY DEFINER function that answers only for the group's secret token.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '@/cloud/supabase';
import { formatMoney, setCurrencySymbol } from '@/lib/money';
import { useDate } from '@/ui/widgets';
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
      </div>
    </div>
  );
}
