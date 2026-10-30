// Android app: receive Kopor's alerts and weekly report through Firebase even when Kopor is closed (owners and
// managers). Asks for notification permission once; tapping a notification opens the screen it is about.
import { Capacitor } from '@capacitor/core';
import { callFunction } from '@/cloud/supabase';

let registered = '';
let listening = false;

export async function registerForAlerts(orgId: string, lang: string) {
  if (!Capacitor.isNativePlatform() || registered === orgId) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  if (!listening) {
    listening = true;
    await PushNotifications.addListener('registration', (t) => {
      void callFunction('push', { action: 'subscribe-fcm', orgId: registered, token: t.value, lang }).catch(() => {});
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const url = String((a.notification.data as { url?: string } | undefined)?.url ?? '');
      if (url.startsWith('#/')) window.location.hash = url.slice(1);
    });
  }
  registered = orgId;
  await PushNotifications.register();
}
