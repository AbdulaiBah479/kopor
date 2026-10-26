// Where the phone is, for checking that staff tap in at the shop. Only a distance is ever stored, never a place.
// The Android app uses the Capacitor location plugin (asks for permission properly and says when location is off);
// the web app uses the browser. Precise GPS is tried first; indoors it is often too slow, so the quicker
// network/Wi-Fi position is used next.
import { Capacitor } from '@capacitor/core';

export interface Point { lat: number; lng: number }
export type Fix = Point & { accuracy: number };
export type LocateError = 'denied' | 'off' | 'timeout' | 'unsupported';
export type Located = { pos: Fix; error?: undefined } | { pos?: undefined; error: LocateError };

type Opts = { enableHighAccuracy: boolean; timeout: number; maximumAge: number };

function kind(e: unknown): LocateError {
  const code = (e as { code?: unknown })?.code;
  const msg = String((e as { message?: unknown })?.message ?? e ?? '');
  if (code === 1 || /denied|permission/i.test(msg)) return 'denied';
  if (/disabled|services|not enabled|turned off|provider/i.test(msg)) return 'off';
  if (code === 2) return 'off';
  return 'timeout';
}

type Watch = (o: Opts, on: (f: Fix) => void, err: (e: unknown) => void) => Promise<() => void>;

const nativeWatch: Watch = async (o, on, err) => {
  const { Geolocation } = await import('@capacitor/geolocation');
  let perm = await Geolocation.checkPermissions();
  if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') perm = await Geolocation.requestPermissions();
  if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') { err({ code: 1, message: 'denied' }); return () => {}; }
  const id = await Geolocation.watchPosition(o, (p, e) => {
    if (e) err(e); else if (p) on({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
  });
  return () => { void Geolocation.clearWatch({ id }); };
};

const webWatch: Watch = async (o, on, err) => {
  const geo = globalThis.navigator?.geolocation;
  if (!geo) { err({ message: 'unsupported' }); return () => {}; }
  const id = geo.watchPosition((p) => on({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), err, o);
  return () => geo.clearWatch(id);
};

/**
 * Exact position: the phone's first answer is often rough (Wi-Fi or a stale GPS fix), and it gets better over the next
 * seconds. Keep listening and return the most exact reading: as soon as it is within goalM metres, or the best one
 * seen when time is up. Fails only when no reading came at all.
 */
function sample(watch: Watch, o: Opts, goalM: number): Promise<Fix> {
  return new Promise((resolve, reject) => {
    let best: Fix | null = null, stop: (() => void) | null = null, over = false;
    const finish = (e?: unknown) => {
      if (over) return; over = true; clearTimeout(timer); stop?.();
      if (best) resolve(best); else reject(e ?? { code: 3, message: 'timeout' });
    };
    const timer = setTimeout(() => finish(), o.timeout);
    watch(o, (f) => {
      if (!best || f.accuracy < best.accuracy) best = f;
      if (f.accuracy <= goalM) finish();
    }, (e) => { if (kind(e) !== 'timeout' || !best) finish(e); })
      .then((s) => { stop = s; if (over) s(); })
      .catch(finish);
  });
}

/** The phone's position, or why it could not be found. Never takes much longer than timeoutMs × 2. */
export async function locate(timeoutMs = 10_000, goalM = 25): Promise<Located> {
  const native = Capacitor.isNativePlatform();
  if (!native && !globalThis.navigator?.geolocation) return { error: 'unsupported' };
  const watch = native ? nativeWatch : webWatch;
  try {
    return { pos: await sample(watch, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }, goalM) };
  } catch (e) {
    const k = kind(e);
    if (k !== 'timeout') return { error: k };
  }
  // No GPS reading at all in time (deep indoors): the network position is rougher but quick.
  try {
    return { pos: await sample(watch, { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60_000 }, 100) };
  } catch (e) { return { error: kind(e) }; }
}

/** Distance in metres between two points (haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * How far from the shop, fairly: a rough position (indoors, ±300 m) must not mark someone as away, so its
 * uncertainty is taken off. Null when the position is too rough to say anything.
 */
export function awayFrom(pos: Fix, shop: Point): number | null {
  if (pos.accuracy > 1000) return null;
  return Math.max(0, distanceM(pos, shop) - Math.round(pos.accuracy));
}
