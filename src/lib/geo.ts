// Where the phone is, for checking that staff tap in at the shop. Only a distance is ever stored, never a place.
export interface Point { lat: number; lng: number }

/** The phone's position, or null if it is off, refused or too slow (never blocks tapping in). */
export function currentPosition(timeoutMs = 8000): Promise<(Point & { accuracy: number }) | null> {
  const geo = globalThis.navigator?.geolocation;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = setTimeout(() => resolve(null), timeoutMs + 500);
    geo.getCurrentPosition(
      (p) => { clearTimeout(done); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      () => { clearTimeout(done); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Distance in metres between two points (haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
