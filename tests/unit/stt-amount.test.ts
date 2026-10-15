import { describe, it, expect } from 'vitest';
import { hasAmount } from '../../supabase/functions/_shared/amount';

describe('hasAmount (retry voice when Whisper drops the amount)', () => {
  it('sees digits and number words', () => {
    expect(hasAmount('Fatu took 2 tins of oil, 360 Leones, on credit')).toBe(true);
    expect(hasAmount('sold rice for three hundred')).toBe(true);
    expect(hasAmount('Mohamed don pay tri tawzin')).toBe(true);
    expect(hasAmount('vendu pour deux mille')).toBe(true);
  });
  it('notices when the amount is missing', () => {
    expect(hasAmount('Aminata Sesay took tins of palm oil on credit')).toBe(false);
    expect(hasAmount('A sel res fo Fatu')).toBe(false);
    expect(hasAmount('Ten')).toBe(true);
    expect(hasAmount('often attended')).toBe(false);
  });
});
