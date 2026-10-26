// Shares this phone's position with the owner and managers while the person is tapped in (only when the owner has
// switched live location on and the person has agreed). In the Android app it keeps going with the screen off and
// shows a notification the whole time; in a browser it works while Kopor is open.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { useSyncExternalStore } from 'react';
import { getMeta, setMeta } from '@/db/repo';
import { distanceM, type Fix } from '@/lib/geo';
import { sharePosition } from '@/cloud/live';

export type LiveState = 'idle' | 'sharing' | 'denied' | 'off' | 'error';
let state: LiveState = 'idle';
let lastSent: (Fix & { t: number }) | null = null;
let stop: (() => void) | null = null;
let running = '';
const listeners = new Set<() => void>();
const set = (s: LiveState) => { if (s !== state) { state = s; listeners.forEach((l) => l()); } };
export const useLiveState = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);

const consentKey = (orgId: string, memberId: string) => `liveOk:${orgId}:${memberId}`;
export const hasLiveConsent = (orgId: string, memberId: string) => getMeta(consentKey(orgId, memberId), false);
export const setLiveConsent = (orgId: string, memberId: string, ok: boolean) => setMeta(consentKey(orgId, memberId), ok);

// Send a reading when it is a minute old, or sooner (20 s) when the person moved more than 30 m. Very rough readings
// (over 500 m) are skipped: they would only mislead the manager.
const MIN_GAP = 20_000, MAX_GAP = 60_000, MOVED_M = 30, ROUGH_M = 500;

async function onFix(orgId: string, f: Fix & { fake?: boolean }) {
  if (f.accuracy > ROUGH_M) return;
  const now = Date.now();
  if (lastSent) {
    const gap = now - lastSent.t;
    if (gap < MIN_GAP || (gap < MAX_GAP && distanceM(lastSent, f) < MOVED_M && f.accuracy >= lastSent.accuracy)) return;
  }
  lastSent = { ...f, t: now };
  try {
    const r = await sharePosition(orgId, f);
    // 'not-working': the tap-in has not reached the server yet (offline); keep listening, it is accepted once synced.
    if (r === 'off') { stopLiveSharing(); return; }
    if (r === 'not-working') { set('idle'); return; }
    set('sharing');
  } catch { set('error'); } // no internet: a later reading tries again (still at most once every 20-60 s)
}

async function start(orgId: string, title: string, body: string) {
  if (Capacitor.isNativePlatform()) {
    const BG = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
    const id = await BG.addWatcher(
      { backgroundTitle: title, backgroundMessage: body, requestPermissions: true, stale: false, distanceFilter: 10 },
      (loc, err) => {
        if (err) { set(err.code === 'NOT_AUTHORIZED' ? 'denied' : 'error'); return; }
        if (loc) void onFix(orgId, { lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy, fake: loc.simulated });
      },
    );
    return () => { void BG.removeWatcher({ id }); };
  }
  const geo = globalThis.navigator?.geolocation;
  if (!geo) { set('off'); return () => {}; }
  const id = geo.watchPosition(
    (p) => void onFix(orgId, { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    (e) => set(e.code === 1 ? 'denied' : e.code === 2 ? 'off' : state),
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 60_000 },
  );
  return () => geo.clearWatch(id);
}

export function stopLiveSharing() {
  stop?.(); stop = null; running = ''; lastSent = null;
  if (state === 'sharing') set('idle');
}

/** Start or stop to match the situation. Safe to call often. */
export async function syncLiveSharing(o: { orgId: string; memberId: string; working: boolean; enabled: boolean; title: string; body: string }) {
  const key = `${o.orgId}:${o.memberId}`;
  const want = o.enabled && o.working && (await hasLiveConsent(o.orgId, o.memberId));
  if (!want) { stopLiveSharing(); return; }
  if (running === key) return;
  stopLiveSharing();
  running = key;
  try { stop = await start(o.orgId, o.title, o.body); } catch { running = ''; set('error'); }
}
