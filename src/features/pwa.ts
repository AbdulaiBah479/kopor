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

export function useInstall() {
  const canInstall = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => !!deferred);
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null; emit();
  };
  return { canInstall, install };
}

export const APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || 'https://abdulaibah479.github.io/kopor/';
