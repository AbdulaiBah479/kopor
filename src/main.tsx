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
// After an update, a page that was already open may ask for a code file of the old version that no longer exists
// ("Importing a module script failed"). Load the new version once instead of failing.
const STALE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i;
const reloadOnce = () => {
  try { if (sessionStorage.getItem('kopor-stale-reload') === '1') return false; sessionStorage.setItem('kopor-stale-reload', '1'); } catch { return false; }
  if (navigator.onLine) location.reload();
  return navigator.onLine;
};
// (No preventDefault: that makes the import "succeed" with nothing in it, which crashed whatever used it.)
window.addEventListener('vite:preloadError', () => { reloadOnce(); });
window.addEventListener('unhandledrejection', (e) => {
  if (STALE.test(String((e.reason as Error)?.message ?? e.reason)) && reloadOnce()) { e.preventDefault(); return; }
  reportError(e.reason);
});
setTimeout(() => { try { sessionStorage.removeItem('kopor-stale-reload'); } catch { /* storage unavailable */ } }, 30_000);

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
