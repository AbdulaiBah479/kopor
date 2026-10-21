// Free reminder notifications (Web Push): this phone asks the browser for a push address and gives it to the Kopor
// server, which sends a reminder when something is due. Works in Chrome/Edge/Firefox on Android and computers, and on
// iPhone when Kopor is added to the Home Screen. (Inside the Android app's web view browsers' push is not available.)
import { getSupabase } from './supabase';

const isNativeApp = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !isNativeApp() && window.isSecureContext;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke('push', { body });
  if (error) throw new Error((await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message);
  return data as T;
}

const keyBytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function browserSubscription(): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error('push.unsupported');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('push.denied');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const { publicKey } = await call<{ publicKey: string }>({ action: 'key' });
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

/** A group member, from the member link: reminders when their contribution or loan repayment is due. */
export async function remindMember(token: string, memberId: string, lang: string) {
  const sub = await browserSubscription();
  await call({ action: 'subscribe', scope: 'member', token, memberId, lang, subscription: sub.toJSON() });
}

/** An owner/manager: a short daily "to do" for the business. */
export async function remindOwner(orgId: string, lang: string) {
  const sub = await browserSubscription();
  await call({ action: 'subscribe', scope: 'org', orgId, lang, subscription: sub.toJSON() });
}

export async function pushIsOn(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export async function stopReminders() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await call({ action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
