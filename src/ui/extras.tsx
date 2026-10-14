// Shared pieces for the v2.1 features: inline barcode scanner, totals block, print/share helpers.
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { formatMoney } from '@/lib/money';
import type { Totals } from '@/domain/tax';
import type { Book } from '@/domain/book';

const Scanner = lazy(() => import('@/features/Scanner'));

/** Toggles an inline camera scanner (stays inside the current form so nothing typed is lost). */
export function ScanToggle({ onCode, label }: { onCode: (code: string) => void; label?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <button type="button" className={`btn sm ${open ? 'primary' : 'ghost'}`} onClick={() => setOpen(!open)}>
        <Icon name="camera" size={16} /> {open ? t('common.close') : label ?? t('scan.scan')}
      </button>
      {open && (
        <Suspense fallback={<div className="muted small">{t('common.loading')}</div>}>
          <Scanner onCode={(c) => { setOpen(false); onCode(c); }} />
        </Suspense>
      )}
    </div>
  );
}

export function TotalsBlock({ totals, book }: { totals: Totals; book: Book }) {
  const { t } = useTranslation();
  if (!totals.discount && !totals.tax) return null;
  return (
    <div className="card flat stack small" data-testid="totals">
      <div className="row between"><span>{t('tax.subtotal')}</span><span className="num">{formatMoney(totals.subtotal)}</span></div>
      {totals.discount > 0 && <div className="row between"><span>{t('tax.discount')}</span><span className="num">-{formatMoney(totals.discount)}</span></div>}
      {totals.tax > 0 && <div className="row between"><span>{t('tax.tax')} ({book.org.tax_rate}%{book.org.tax_inclusive ? `, ${t('tax.included')}` : ''})</span><span className="num">{formatMoney(totals.tax)}</span></div>}
      <div className="row between"><b>{t('common.total')}</b><b className="num">{formatMoney(totals.total)}</b></div>
    </div>
  );
}

/** Run an async export/print action with a busy state and error toast. */
export function ActionButton({ icon, label, run, className = 'btn', testId }: { icon: string; label: string; run: () => Promise<unknown>; className?: string; testId?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={busy} data-testid={testId} onClick={async () => { setBusy(true); try { await run(); } finally { setBusy(false); } }}>
      <Icon name={icon} size={18} /> {label}
    </button>
  );
}
