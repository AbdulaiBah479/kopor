// Public, read-only invoice page a customer opens from a shared link. Data comes from a
// SECURITY DEFINER function that returns only that one invoice for a secret, unguessable token.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportBusinessLink } from './Report';
import { LoadFailed } from './PublicStatement';
import { getSupabase } from '@/cloud/supabase';
import { formatMoney, setCurrencySymbol } from '@/lib/money';
import { useDate } from '@/ui/widgets';
import type { LineItem } from '@/db/schema';

interface PublicInv {
  number: string; customer: string; date: string; due_date: string | null; status: string; items: LineItem[]; notes: string;
  discount: number; tax: number; total: number; org_name: string; org_phone: string; org_address: string; momo_number: string; currency: string; tax_id: string; pay_url: string | null;
}

export function PublicInvoice() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { fmt } = useDate();
  const [inv, setInv] = useState<PublicInv | null | undefined | 'error'>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    getSupabase().then(async (sb) => {
      if (!sb) return setInv(null);
      const { data, error } = await sb.rpc('public_invoice', { token }).abortSignal(AbortSignal.timeout(15_000));
      if (error) return setInv('error');
      const row = (Array.isArray(data) ? data[0] : data) as PublicInv | undefined;
      if (row) setCurrencySymbol(row.currency);
      setInv(row ?? null);
    }).catch(() => setInv('error'));
  }, [token, attempt]);
  if (inv === undefined) return <div className="boot"><div className="boot-logo">K</div></div>;
  if (inv === 'error') return <LoadFailed onRetry={() => { setInv(undefined); setAttempt(attempt + 1); }} />;
  if (!inv) return <div className="shell"><div className="content"><div className="empty"><b>{t('public.notFound')}</b></div></div></div>;
  const total = Number(inv.total);
  const paid = inv.status === 'paid';
  const quote = inv.status === 'quote' || inv.status === 'accepted';
  const unpaid = inv.status === 'unpaid';
  return (
    <div className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 20 }}>
        <div className="doc">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div><h2>{inv.org_name}</h2><div className="small">{inv.org_address}<br />{inv.org_phone}</div></div>
            <div style={{ textAlign: 'right' }}><b>{t(quote ? 'quote.title' : paid ? 'inv.receipt' : 'inv.invoice')}</b><div className="small">{inv.number}</div></div>
          </div>
          <div className="meta" style={{ marginTop: 16 }}>
            <div><div className="small">{t('inv.billTo')}</div><b>{inv.customer}</b></div>
            <div className="small" style={{ textAlign: 'right' }}>{t('common.date')}: {fmt(inv.date)}{!paid && inv.due_date && <><br />{t(quote ? 'quote.validUntil' : 'inv.due')}: {fmt(inv.due_date)}</>}</div>
          </div>
          <table>
            <tbody>
              {inv.items.map((i, k) => <tr key={k}><td>{i.qty} × {i.name}</td><td className="r">{formatMoney(i.qty * i.price)}</td></tr>)}
              {Number(inv.discount) > 0 && <tr><td>{t('tax.discount')}</td><td className="r">-{formatMoney(Number(inv.discount))}</td></tr>}
              {Number(inv.tax) > 0 && <tr><td>{t('tax.tax')}</td><td className="r">{formatMoney(Number(inv.tax))}</td></tr>}
              <tr className="tot"><td>{t('common.total')}</td><td className="r">{formatMoney(total)}</td></tr>
            </tbody>
          </table>
          {inv.notes && <div className="small">{inv.notes}</div>}
          {quote && <div className="small">{t('quote.notice')}</div>}
          {unpaid && inv.momo_number && <div className="small"><b>{t('inv.payMomo')}:</b> {inv.momo_number}</div>}
          <div className="foot">{t('inv.generated')}</div>
        </div>
        {unpaid && inv.pay_url && /^https:\/\//.test(inv.pay_url) && <a className="btn primary block" href={inv.pay_url} rel="noopener noreferrer">{t('public.pay')}</a>}
        <ReportBusinessLink business={inv.org_name} />
      </div>
    </div>
  );
}
