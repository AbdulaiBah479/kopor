// Camera button for screen headers: opens the receipt scanner from anywhere (Stock, Cash Book), not only Home.
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { lazyRetry } from './lazy';
import { useOverlay } from './overlay';
import { Icon } from './Icon';

const ScanSheet = lazyRetry(() => import('@/screens/AiSheets').then((m) => ({ default: m.ScanSheet })));

/** prefer: what the photo is most likely for on this screen (e.g. 'purchase' on Stock); the reading can still change it. */
export function ScanButton({ prefer }: { prefer?: 'purchase' | 'sale' }) {
  const { t } = useTranslation();
  const { openSheet } = useOverlay();
  return (
    <button className="icon-btn" aria-label={t('ai.scanTitle')} data-testid="header-scan"
      onClick={() => openSheet(t('ai.scanTitle'), <Suspense fallback={t('common.loading')}><ScanSheet prefer={prefer} /></Suspense>)}>
      <Icon name="camera" size={22} />
    </button>
  );
}
