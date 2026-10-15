import { describe, expect, it } from 'vitest';
import { bestMatch, distance, fold } from '@/lib/fuzzy';
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
