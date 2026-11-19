import { describe, expect, it } from 'vitest';
import { usdNote, usdToLe } from '@/ui/Usd';

describe('paid in dollars', () => {
  it('turns dollars into Leones (minor units) at the rate', () => {
    expect(usdToLe(20, 23.04)).toBe(46_080);        // $20 = Le 460.80
    expect(usdToLe(1.5, 23)).toBe(3_450);
  });
  it('keeps the dollars and the rate in the note', () => {
    expect(usdNote(20, 23.04)).toBe('($20 @ Le 23.04)');
    expect(usdNote(12.5, 22.9)).toBe('($12.50 @ Le 22.90)');
  });
});
