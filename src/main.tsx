import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './i18n';
import './styles.css';
import { App } from './App';
import { initMonitoring, reportError } from './features/monitoring';
import { applyTheme } from './state/app';
import { initInstallPrompt } from './features/pwa';

applyTheme('auto'); // before the first paint, so there is no light/dark flash

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

initMonitoring();
initInstallPrompt();
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

// Offline support (Workbox service worker via vite-plugin-pwa). New versions activate automatically.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
navigator.storage?.persist?.();
