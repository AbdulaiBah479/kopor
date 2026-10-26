// "Install Kopor" support: Chrome/Android fire `beforeinstallprompt` once; keep it so a button can show the
// install dialog later. (iPhone users install with Share → Add to Home Screen; no event exists there.)
import { useSyncExternalStore } from 'react';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
}

/** How this device installs Kopor: one-tap dialog, or the steps for its browser. Null when already installed. */
export type InstallHow = 'prompt' | 'ios' | 'mac' | 'android' | 'desktop';
export function installHow(): InstallHow | null {
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.Capacitor?.isNativePlatform?.()) return null;
  const standalone = matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
  if (standalone) return null;
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch tells them apart.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return 'mac';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export function useInstall() {
  const canInstall = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => !!deferred);
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null; emit();
  };
  return { canInstall, install, how: canInstall ? 'prompt' as const : installHow() };
}

export { APP_URL } from '@/lib/links';
