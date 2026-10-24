// "New version available" for the Android test app: once a day, ask GitHub for the newest published test build and
// compare its number with this app's (VITE_APP_BUILD, set by the Android build). The web app needs none of this: it
// updates itself through the service worker.
import { getMeta, setMeta } from '@/db/repo';

const RELEASE = 'https://api.github.com/repos/AbdulaiBah479/kopor/releases/tags/test-latest';
export const APK_URL = 'https://github.com/AbdulaiBah479/kopor/releases/download/test-latest/kopor-test.apk';
const DAY = 86_400_000;

export interface Update { build: number; notes: string[] }

const isNative = () => !!(globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
export const thisBuild = () => Number(import.meta.env.VITE_APP_BUILD ?? 0) || 0;

/** The newest build number among the release's files (kopor-test-123.apk) and its "What's new" lines. */
export function readRelease(r: { body?: string | null; assets?: { name: string }[] }): Update | null {
  const builds = (r.assets ?? []).map((a) => Number(a.name.match(/^kopor-test-(\d+)\.apk$/)?.[1] ?? 0)).filter(Boolean);
  if (!builds.length) return null;
  const body = r.body ?? '';
  const notes = body.slice(body.indexOf("What's new:")).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()).slice(0, 8);
  return { build: Math.max(...builds), notes };
}

/** A newer build than this one, checked at most once a day (the answer is remembered on the phone). */
export async function checkForUpdate(now = Date.now()): Promise<Update | null> {
  const mine = thisBuild();
  if (!isNative() || !mine || globalThis.navigator?.onLine === false) return null;
  const cached = await getMeta<{ at: number; update: Update | null } | null>('appUpdate', null);
  let update = cached?.update ?? null;
  if (!cached || now - cached.at > DAY) {
    try {
      const res = await fetch(RELEASE, { headers: { Accept: 'application/vnd.github+json' } });
      if (res.ok) { update = readRelease(await res.json()); await setMeta('appUpdate', { at: now, update }); }
    } catch { /* offline or GitHub busy: try again next time */ }
  }
  const skipped = await getMeta<number>('appUpdateSkipped', 0);
  return update && update.build > mine && update.build > skipped ? update : null;
}

/** "Later": hide this build's card (a newer build shows again). */
export const skipUpdate = (build: number) => setMeta('appUpdateSkipped', build);
