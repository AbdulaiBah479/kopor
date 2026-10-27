// The public price list a customer opens from the shop's link or QR code: the real prices, so nobody can charge more.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportBusinessLink } from './Report';
import { LoadFailed } from './PublicStatement';
import { openCatalog, type Catalog } from '@/cloud/catalog';
import { formatMoney, setCurrencySymbol } from '@/lib/money';

export function PublicCatalog() {
  const { token } = useParams();
  const { t } = useTranslation();
  // undefined = loading, null = no such link, 'error' = could not reach the server.
  const [c, setC] = useState<Catalog | null | undefined | 'error'>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => {
    openCatalog(String(token)).then((row) => { if (row) setCurrencySymbol(row.currency); setC(row); }).catch(() => setC('error'));
  }, [token, attempt]);
  if (c === undefined) return <div className="boot"><div className="boot-logo">K</div></div>;
  if (c === 'error') return <LoadFailed onRetry={() => { setC(undefined); setAttempt(attempt + 1); }} />;
  if (!c) return <div className="shell"><div className="content"><div className="empty" data-testid="catalog-missing"><b>{t('price.notFound')}</b></div></div></div>;
  const shown = c.products.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 20 }}>
        <div className="doc" data-testid="public-catalog">
          <h2>{c.name}</h2>
          <div className="small">{c.address}{c.phone && <><br />{c.phone}</>}{c.momo && <><br />{t('stmt.payTo')}: {c.momo}</>}</div>
          <div className="card flat small" style={{ marginTop: 12 }}>{t('price.trust')}</div>
          {c.products.length > 8 && <input className="input" style={{ marginTop: 12 }} type="search" placeholder={t('price.search')} aria-label={t('price.search')} value={q} onChange={(e) => setQ(e.target.value)} />}
          <table>
            <thead><tr><th>{t('price.item')}</th><th className="r">{t('price.price')}</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.name} style={p.in_stock ? undefined : { opacity: 0.55 }}>
                  <td>{p.name}{!p.in_stock && <span className="small"> · {t('catalog.soldOut')}</span>}
                    {p.pack_size && p.pack_price ? <div className="small">{p.pack_name || t('price.carton')} ({p.pack_size}): {formatMoney(Number(p.pack_price))}</div> : null}</td>
                  <td className="r num">{formatMoney(Number(p.price))}{p.unit ? <span className="small"> /{p.unit}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="foot">{t('price.foot')}</div>
        </div>
        <ReportBusinessLink business={c.name} />
      </div>
    </div>
  );
}
