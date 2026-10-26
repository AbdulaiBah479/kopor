// Owners and managers: watch for new fraud alerts while Kopor is open (every 2 minutes, and after each sync).
// New ones show as a banner on Home and, in the Android app, as a phone notification. Opening Fraud watch marks
// them seen. (Phones with notifications switched on also get them from the server even when Kopor is closed.)
import type { TFunction } from 'i18next';
import { getMeta, setMeta } from '@/db/repo';
import { formatMoney } from '@/lib/money';
import { recentAlerts, type AlertRow } from '@/cloud/alerts';

import { currentAlerts, setAlerts } from './alertStore';

const isNative = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
const seenKey = (orgId: string) => `alertSeen:${orgId}`;
const notifiedKey = (orgId: string) => `alertNotified:${orgId}`;

/** One alert as a sentence, in the app's language. */
export const alertText = (t: TFunction, a: AlertRow) => t(`watch.alert.${a.kind}`, {
  who: a.who || '—', amount: formatMoney(a.amount), m: a.detail, date: a.detail.slice(0, 10), what: t(a.detail === 'ledger' ? 'watch.alert.credit' : 'watch.alert.sale'),
});

export async function checkAlerts(orgId: string, t: TFunction) {
  const list = await recentAlerts(orgId);
  const seen = await getMeta(seenKey(orgId), 0);
  setAlerts(list, list.filter((a) => a.id > seen).length);
  // Android app: a notification for each alert not shown before (the first check only remembers where it is).
  const notified = await getMeta<number | null>(notifiedKey(orgId), null);
  const top = list[0]?.id ?? 0;
  if (notified === null) { await setMeta(notifiedKey(orgId), top); return; }
  const fresh = list.filter((a) => a.id > notified).slice(0, 5);
  if (!fresh.length) return;
  await setMeta(notifiedKey(orgId), top);
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  await LocalNotifications.schedule({
    notifications: fresh.map((a) => ({ id: 800_000 + (a.id % 100_000), title: t('watch.alert.title'), body: alertText(t, a), extra: { url: '#/watch' } })),
  });
}

export async function markAlertsSeen(orgId: string) {
  const list = currentAlerts();
  await setMeta(seenKey(orgId), list[0]?.id ?? 0);
  setAlerts(list, 0);
}

let timer = 0;
/** Start (or restart) watching for this business; stop with stopAlertWatch. */
export function startAlertWatch(orgId: string, t: TFunction) {
  stopAlertWatch();
  const run = () => { if (document.visibilityState === 'visible') checkAlerts(orgId, t).catch(() => {}); };
  run();
  timer = window.setInterval(run, 120_000);
}
export function stopAlertWatch() { if (timer) window.clearInterval(timer); timer = 0; setAlerts([], 0); }
