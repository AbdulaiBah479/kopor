import { describe, expect, it } from 'vitest';
import { keepsMeaning } from '@/ai/assistant';

const book = { contacts: [{ name: 'Aminata Sesay' }, { name: 'Mohamed Bangura' }], products: [{ name: 'Palm oil 4L' }, { name: 'Milk tin' }] } as never;

describe('AI transcript correction is only accepted when it keeps the meaning', () => {
  it('accepts fixing a misheard name and spelling', () => {
    expect(keepsMeaning('Amin Adicesse took 2 tins of palm oil, 360 liones, on credit.', 'Aminata Sesay took 2 tins of palm oil, 360 Leones, on credit.', book)).toBe(true);
    expect(keepsMeaning('Mohammed don pay 250', 'Mohamed don pay 250', book)).toBe(true);
  });
  it('rejects a rewrite that drops the amount or invents a product (the bug that was seen)', () => {
    expect(keepsMeaning('Aminatta took 2 tins of palm oil, 360 Leones, on credit', 'Aminata tek Milk tin', book)).toBe(false);
  });
  it('rejects a changed amount or a changed action', () => {
    expect(keepsMeaning('Sold 3 bags rice 2550 cash', 'Sold 3 bags rice 2050 cash', book)).toBe(false);
    expect(keepsMeaning('Mohamed don pay 250', 'Mohamed took 250 on credit', book)).toBe(false);
  });
  it('fills words Whisper skipped from the second listener (Gemini), but never invents an amount', () => {
    const whisper = 'Aminata Sesay took 2 tins of palm oil on credit.';
    const gemini = 'Aminata Sesay took 2 tins of palm oil, 360 Leones, on credit.';
    expect(keepsMeaning(whisper, gemini, book, gemini)).toBe(true);
    expect(keepsMeaning(whisper, 'Aminata Sesay took 2 tins of palm oil, 500 Leones, on credit.', book, gemini)).toBe(false);
    expect(keepsMeaning('Aminata Sesay took tins of palm oil on credit', 'Aminata Sesay took tins of palm oil, 500 Leones, on credit', book)).toBe(false);
    expect(keepsMeaning('Mohamed don pay tri hundred', 'Mohamed don pay 300', book)).toBe(true);
    // When the two versions disagree on the amount, either heard amount is allowed, a third is not.
    expect(keepsMeaning('Sold rice 2550 cash', 'Sold rice 2500 cash', book, 'Sold rice 2500 cash')).toBe(true);
    expect(keepsMeaning('Sold rice 2550 cash', 'Sold rice 2000 cash', book, 'Sold rice 2500 cash')).toBe(false);
  });
  it('rejects a translation or summary', () => {
    expect(keepsMeaning('Spent 200 on transport today for the shop', 'A spɛn 200 fɔ transpɔt', book)).toBe(false);
  });
});
