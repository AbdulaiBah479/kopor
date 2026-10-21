// Camera button: one tap, then choose what you are pointing at: an item, or a receipt / notebook page.
// Used in screen headers (Stock, Cash Book) and on Home.
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { lazyRetry } from './lazy';
import { useOverlay } from './overlay';
import { Icon } from './Icon';

const ScanSheet = lazyRetry(() => import('@/screens/AiSheets').then((m) => ({ default: m.ScanSheet })));
const ItemScanSheet = lazyRetry(() => import('@/screens/AiSheets').then((m) => ({ default: m.ItemScanSheet })));

/** prefer: what the photo is most likely for on this screen ('purchase' on Stock, 'sale' on the Cash Book). */
export function ScanChooser({ prefer }: { prefer?: 'purchase' | 'sale' }) {
  const { t } = useTranslation();
  const { openSheet } = useOverlay();
  const option = (icon: string, title: string, sub: string, testId: string, open: () => void) => (
    <button type="button" className="item" data-testid={testId} onClick={open} style={{ width: '100%', border: 0, textAlign: 'left', font: 'inherit' }}>
      <span className="tile" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name={icon} size={20} /></span>
      <div className="main"><div className="t">{title}</div><div className="s">{sub}</div></div>
      <Icon name="chev" size={18} className="text-subtle" />
    </button>
  );
  return (
    <div className="list" data-testid="scan-chooser">
      {option('box', t('item.chooseItem'), t('item.chooseItemSub'), 'choose-item', () => openSheet(t('item.title'),
        <Suspense fallback={t('common.loading')}><ItemScanSheet prefer={prefer === 'sale' ? 'sale' : 'stock'} /></Suspense>))}
      {option('receipt', t('item.chooseReceipt'), t('item.chooseReceiptSub'), 'choose-receipt', () => openSheet(t('ai.scanTitle'),
        <Suspense fallback={t('common.loading')}><ScanSheet prefer={prefer} /></Suspense>))}
    </div>
  );
}

export function ScanButton({ prefer }: { prefer?: 'purchase' | 'sale' }) {
  const { t } = useTranslation();
  const { openSheet } = useOverlay();
  return (
    <button className="icon-btn" aria-label={t('ai.scanTitle')} data-testid="header-scan" onClick={() => openSheet(t('item.chooseTitle'), <ScanChooser prefer={prefer} />)}>
      <Icon name="camera" size={22} />
    </button>
  );
}
