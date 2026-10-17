// Public, read-only account statement a customer opens from a shared link. Data comes from a SECURITY DEFINER
// function that returns only this customer's balance and entries for a secret, unguessable token (no phone numbers).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportBusinessLink } from './Report';
import { getSupabase } from '@/cloud/supabase';
import { formatMoney, setCurrencySymbol } from '@/lib/money';
import { useDate } from '@/ui/widgets';

interface Statement {
  name: string; org_name: string; org_phone: string; org_address: string; momo_number: string; currency: string; balance: number;
  entries: { date: string; type: 'gave' | 'got'; amount: number; note: string; due_date: string | null }[];
}

export function PublicStatement() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { fmt } = useDate();
  const [s, setS] = useState<Statement | null | undefined>(undefined);
  useEffect(() => {
    getSupabase().then(async (sb) => {
      if (!sb) return setS(null);
      const { data } = await sb.rpc('public_statement', { token });
      const row = data as Statement | null;
      if (row) setCurrencySymbol(row.currency);
      setS(row ?? null);
    }).catch(() => setS(null));
  }, [token]);
  if (s === undefined) return <div className="boot"><div className="boot-logo">K</div></div>;
  if (!s) return <div className="shell"><div className="content"><div className="empty" data-testid="statement-missing"><b>{t('stmt.notFound')}</b></div></div></div>;
  const bal = Number(s.balance);
  return (
    <div className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 20 }}>
        <div className="doc" data-testid="public-statement">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div><h2>{s.org_name}</h2><div className="small">{s.org_address}{s.org_phone && <><br />{s.org_phone}</>}</div></div>
            <div style={{ textAlign: 'right' }}><b>{t('stmt.title')}</b><div className="small">{s.name}</div></div>
          </div>
          <div className="card flat" style={{ marginTop: 16, textAlign: 'center' }}>
            <div className="small muted">{bal > 0 ? t('stmt.youOwe') : bal < 0 ? t('stmt.theyOwe', { business: s.org_name }) : t('stmt.settled')}</div>
            {bal !== 0 && <div className={`big num ${bal > 0 ? 'bad' : 'good'}`}>{formatMoney(Math.abs(bal))}</div>}
            <div className="small muted">{t('stmt.live')}</div>
          </div>
          {bal > 0 && s.momo_number && <div className="small" style={{ marginTop: 8 }}><b>{t('stmt.payTo')}:</b> {s.momo_number}</div>}
          <table>
            <thead><tr><th>{t('common.date')}</th><th>{t('stmt.entries')}</th><th className="r">{t('common.amount')}</th></tr></thead>
            <tbody>
              {s.entries.map((e, k) => (
                <tr key={k}>
                  <td>{fmt(e.date)}</td>
                  <td>{e.type === 'gave' ? t('stmt.took') : t('stmt.paid')}{e.note && <div className="small">{e.note}</div>}</td>
                  <td className="r num">{e.type === 'gave' ? '' : '-'}{formatMoney(Number(e.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="foot">{t('inv.generated')}</div>
        </div>
        <ReportBusinessLink business={s.org_name} />
      </div>
    </div>
  );
}
