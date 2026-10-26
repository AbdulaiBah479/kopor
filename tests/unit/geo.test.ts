import { afterEach, describe, expect, it, vi } from 'vitest';
import { awayFrom, distanceM, locate } from '@/lib/geo';

const shop = { lat: 8.4844, lng: -13.2344 }; // Freetown
type Cb = (p: unknown) => void;
const mockGeo = (impl: (ok: Cb, bad: Cb, o: PositionOptions) => void) => {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
};
const at = (lat: number, lng: number, accuracy: number) => ({ coords: { latitude: lat, longitude: lng, accuracy } });

afterEach(() => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); });

describe('finding the phone', () => {
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
