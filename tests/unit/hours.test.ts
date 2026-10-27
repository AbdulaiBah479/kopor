import { describe, expect, it } from 'vitest';
import { isOpenNow } from '@/domain/hours';

const at = (iso: string) => new Date(iso);

describe('business hours (same answers as the server)', () => {
  it('default: 08:00-18:00, Monday to Saturday', () => {
    expect(isOpenNow({}, at('2026-10-26T09:00:00Z'))).toBe(true);    // Monday
    expect(isOpenNow({}, at('2026-10-26T07:59:00Z'))).toBe(false);
    expect(isOpenNow({}, at('2026-10-26T18:00:00Z'))).toBe(false);
    expect(isOpenNow({}, at('2026-11-01T10:00:00Z'))).toBe(false);   // Sunday
  });
  it('night shift past midnight belongs to the day it started', () => {
    const night = { open_at: '20:00', close_at: '06:00', work_days: 63 };
    expect(isOpenNow(night, at('2026-10-26T23:00:00Z'))).toBe(true);  // Monday night
    expect(isOpenNow(night, at('2026-10-27T05:00:00Z'))).toBe(true);  // still Monday's shift
    expect(isOpenNow(night, at('2026-10-26T12:00:00Z'))).toBe(false);
    expect(isOpenNow(night, at('2026-11-02T05:00:00Z'))).toBe(false); // Monday early: Sunday was not a working day
  });
  it('open all day when opening and closing times are the same', () => {
    expect(isOpenNow({ open_at: '00:00', close_at: '00:00', work_days: 127 }, at('2026-11-01T03:00:00Z'))).toBe(true);
  });
});
