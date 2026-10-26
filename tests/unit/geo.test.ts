import { afterEach, describe, expect, it, vi } from 'vitest';
import { awayFrom, distanceM, locate } from '@/lib/geo';

const shop = { lat: 8.4844, lng: -13.2344 }; // Freetown
type Cb = (p: unknown) => void;
const mockGeo = (impl: (ok: Cb, bad: Cb, o: PositionOptions) => void) => {
  const watchPosition = vi.fn((ok: Cb, bad: Cb, o: PositionOptions) => { impl(ok, bad, o); return 1; });
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch }, configurable: true });
  return watchPosition;
};
const at = (lat: number, lng: number, accuracy: number) => ({ coords: { latitude: lat, longitude: lng, accuracy } });

afterEach(() => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); });

describe('finding the phone', () => {
  it('keeps listening and returns the most exact reading, stopping once it is exact enough', async () => {
    mockGeo((ok) => { ok(at(8.49, -13.23, 900)); ok(at(8.4846, -13.2345, 40)); ok(at(8.4845, -13.2344, 9)); ok(at(8.5, -13.3, 500)); });
    expect((await locate(200)).pos).toMatchObject({ accuracy: 9, lat: 8.4845 });
  });

  it('returns the best reading seen when time runs out before it is exact', async () => {
    mockGeo((ok) => { ok(at(8.49, -13.23, 300)); ok(at(8.4846, -13.2345, 80)); });
    expect((await locate(60)).pos?.accuracy).toBe(80);
  });

  it('uses precise GPS when it answers', async () => {
    mockGeo((ok) => ok(at(8.4845, -13.2345, 12)));
    expect((await locate(50)).pos).toMatchObject({ accuracy: 12 });
  });

  it('falls back to the quicker network position when GPS is too slow indoors', async () => {
    const get = mockGeo((ok, bad, o) => (o.enableHighAccuracy ? bad({ code: 3, message: 'Timeout expired' }) : ok(at(8.4846, -13.2346, 60))));
    const r = await locate(50);
    expect(r.pos?.accuracy).toBe(60);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says why: refused, switched off, or no location at all', async () => {
    mockGeo((_ok, bad) => bad({ code: 1, message: 'User denied Geolocation' }));
    expect((await locate(50)).error).toBe('denied');
    mockGeo((_ok, bad) => bad({ code: 2, message: 'Position unavailable' }));
    expect((await locate(50)).error).toBe('off');
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    expect((await locate(50)).error).toBe('unsupported');
  });
});

describe('distance from the shop', () => {
  it('takes off the position’s uncertainty so a rough indoor fix does not mark someone away', () => {
    const near = { lat: 8.4870, lng: -13.2344, accuracy: 300 }; // about 290 m off, ±300 m
    expect(distanceM(near, shop)).toBeGreaterThan(250);
    expect(awayFrom(near, shop)).toBe(0);
    expect(awayFrom({ lat: 8.4944, lng: -13.2344, accuracy: 20 }, shop)).toBeGreaterThan(1000); // really away
    expect(awayFrom({ ...shop, accuracy: 3000 }, shop)).toBeNull();                                // too rough to say
  });
});
