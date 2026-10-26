// What the alert watcher found (kept apart from it, so Home can show the banner without loading the cloud code).
import { useSyncExternalStore } from 'react';
import type { AlertRow } from '@/cloud/alerts';

let alerts: AlertRow[] = [];
let unseen = 0;
const listeners = new Set<() => void>();
const sub = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const useUnseenAlerts = () => useSyncExternalStore(sub, () => unseen);
export const useAlerts = () => useSyncExternalStore(sub, () => alerts);
export const currentAlerts = () => alerts;
export function setAlerts(list: AlertRow[], newCount: number) { alerts = list; unseen = newCount; listeners.forEach((l) => l()); }
