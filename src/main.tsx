import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './i18n';
import './styles.css';
import { App } from './App';
import { initMonitoring, reportError } from './features/monitoring';
import { applySavedAppearance } from './state/app';
import { initInstallPrompt } from './features/pwa';

applySavedAppearance(); // before the first paint, so there is no colour flash

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

initMonitoring();
initInstallPrompt();
// Problem reports written while offline are sent when the connection is back.
const flush = () => import('./cloud/reports').then((m) => m.flushReports()).catch(() => {});
setTimeout(flush, 5000);
window.addEventListener('online', flush);
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

// Offline support (Workbox service worker via vite-plugin-pwa). New versions activate automatically.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
navigator.storage?.persist?.();

// Android app: tapping the morning reminder opens the screen it is about.
if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
  import('@capacitor/local-notifications').then(({ LocalNotifications }) =>
    LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const url = (a.notification.extra as { url?: string } | undefined)?.url;
      if (url?.startsWith('#/')) window.location.hash = url.slice(1);
    })).catch(() => {});
}
