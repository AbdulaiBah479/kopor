import { describe, it, expect } from 'vitest';
import { hasAmount, krioWords } from '../../supabase/functions/_shared/amount';

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

describe('krioWords (Krio speech makes Gemini the main listener)', () => {
  it('counts different everyday Krio words', () => {
    expect(krioWords('Fatu tek 2 tin ɔyl pan trɔs')).toBeGreaterThanOrEqual(2);
    expect(krioWords('Mohamed dɔn pe 300')).toBeGreaterThanOrEqual(2);
    expect(krioWords('A sel tu bag res fo 1700')).toBeGreaterThanOrEqual(2);
  });
  it('does not mistake English for Krio', () => {
    expect(krioWords('Aminata Sesay took 2 tins of palm oil, 360 Leones, on credit')).toBeLessThan(2);
    expect(krioWords('Sold 3 bags of rice for 2500 cash')).toBeLessThan(2);
  });
});
