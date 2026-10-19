import { describe, expect, it } from 'vitest';
import { bestMatch, distance, fold, matchProduct } from '@/lib/fuzzy';
import { parseLocal } from '@/ai/parser';

const customers = ['Aminata Sesay', 'Mohamed Bangura', 'Isatu Conteh', 'Abu Kamara', 'Kroo Bay Wholesale'];
const products = ['Rice 50kg bag', 'Palm oil 4L', 'Maggi cubes (box)', 'Sugar 1kg', 'Soap bar', 'Onions'];

describe('fuzzy matching for voice mistakes', () => {
  it('folds Krio letters and accents', () => expect(fold('Dɔn pe Ɛni')).toBe('don pe eni'));
  it('measures edits', () => expect(distance('aminata', 'aminatta')).toBe(1));
  it.each([
    ['Aminatta took two bags', 'Aminata Sesay'], ['aminata', 'Aminata Sesay'], ['Mohammed paid 250', 'Mohamed Bangura'],
    ['Isatu Konteh owes me', 'Isatu Conteh'], ['abu camara', 'Abu Kamara'], ['sold to Kru Bay wholesale', 'Kroo Bay Wholesale'],
  ])('customer: %s', (heard, expected) => expect(bestMatch(heard, customers)).toBe(expected));
  it.each([
    ['sold three bags of rise', 'Rice 50kg bag'], ['palm oyl', 'Palm oil 4L'], ['magi cube', 'Maggi cubes (box)'], ['shuga', 'Sugar 1kg'],
  ])('product: %s', (heard, expected) => expect(bestMatch(heard, products)).toBe(expected));
  it('does not invent matches', () => {
    expect(bestMatch('spent 100 on transport', customers)).toBeUndefined();
    expect(bestMatch('a sale today', products)).toBeUndefined();
  });
  it('the offline parser uses it for misheard names and products', () => {
    const r = parseLocal('Aminatta took 2 tins of palm oyl 360 on credit', { contacts: customers, products });
    expect(r.name).toBe('Aminata Sesay');
    expect(r.item).toBe('Palm oil 4L');
    expect(r.action).toBe('credit_given');
  });
});

describe('matchProduct (receipt lines to the stock list)', () => {
  const products = ['Rice 50kg bag', 'Maggi cubes (box)', 'Sugar 1kg', 'Palm oil 4L', 'Soap bar'];
  it('finds the same product despite spelling, size and packaging words', () => {
    expect(matchProduct('rice 50kg', products)).toBe('Rice 50kg bag');
    expect(matchProduct('RICE BAG', products)).toBe('Rice 50kg bag');
    expect(matchProduct('Shugar', products)).toBe('Sugar 1kg');
    expect(matchProduct('palm oyl 4 litre', products)).toBe('Palm oil 4L');
    expect(matchProduct('Maggi box', products)).toBe('Maggi cubes (box)');
  });
  it('does not match on packaging words or unrelated items (they become new products)', () => {
    expect(matchProduct('Candles box', products)).toBeUndefined();
    expect(matchProduct('Bag', products)).toBeUndefined();
    expect(matchProduct('Washing powder', products)).toBeUndefined();
    expect(matchProduct('Soap dish', products)).toBeUndefined();
  });
});

describe('buying stock by voice (English and Krio) adds stock instead of only an expense', () => {
  const known = { contacts: ['Aminata Sesay'], products: ['Rice 50kg bag', 'Sugar 1kg', 'Palm oil 4L'] };
  it('recognises bought goods that the shop sells', () => {
    const a = parseLocal('Bought 5 bags rice 3500', known);
    expect([a.action, a.item, a.qty, a.amount]).toEqual(['purchase', 'Rice 50kg bag', 5, 350000]);
    const b = parseLocal('A bay 10 shuga 250', known);
    expect([b.action, b.item, b.qty]).toEqual(['purchase', 'Sugar 1kg', 10]);
  });
  it('keeps other spending as an expense', () => {
    expect(parseLocal('Bought fuel 200', known).action).toBe('expense');
    expect(parseLocal('Spent 120 on transport', known).action).toBe('expense');
  });
});
