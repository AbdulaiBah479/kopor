import { describe, expect, it } from 'vitest';
import { parseWallets, formatWallets, encodePayRequest, decodePayRequest, dialLink } from '@/domain/wallets';
import { detectIntent } from '@/ai/offline';

describe('mobile money numbers', () => {
  it('reads numbers back from the business field', () => {
    expect(parseWallets('Orange Money 076 123 456')).toEqual({ orange: '076123456' });
    expect(parseWallets('Orange Money 076123456 · Afrimoney 077 555 111 · QMoney 031 222 333'))
      .toEqual({ orange: '076123456', afrimoney: '077555111', qmoney: '031222333' });
    expect(parseWallets('')).toEqual({});
    expect(parseWallets('call me')).toEqual({});
  });
  it('round-trips through the stored text', () => {
    const w = { orange: '076123456', qmoney: '031222333' };
    expect(parseWallets(formatWallets(w))).toEqual(w);
    expect(formatWallets({})).toBe('');
  });
  it('encodes # in USSD dial links', () => {
    expect(dialLink('*144#')).toBe('tel:*144%23');
  });
});

describe('pay-me links', () => {
  it('round-trip, including Krio letters', () => {
    const p = { b: 'Fatu Provishɔn', a: 150000, c: 'Le', r: '2 bag rɛs', w: [['orange', '076123456'], ['afrimoney', '077555111']] as ['orange' | 'afrimoney', string][] };
    expect(decodePayRequest(encodePayRequest(p))).toEqual(p);
  });
  it('reject tampered or junk data', () => {
    expect(decodePayRequest('not-base64!!')).toBeNull();
    expect(decodePayRequest(btoa(JSON.stringify({ b: 'x', a: -5, w: [] })))).toBeNull();
    const bad = decodePayRequest(btoa(JSON.stringify({ b: 'x', a: 1, w: [['evilnet', '076123456'], ['orange', 'javascript:alert(1)']] })));
    expect(bad?.w).toEqual([]);
  });
});

describe('offline assistant understands English and Krio questions', () => {
  it.each([
    ['Who owes me the most?', 'debts'], ['Udat ɔw mi pas?', 'debts'], ['udat ow mi', 'debts'],
    ['What should I restock this week?', 'restock'], ['Wetin a fɔ bay bak dis wik?', 'restock'],
    ['How is my business doing this month?', 'profit'], ['Aw mi biznɛs de du dis mɔnt?', 'profit'],
    ['What are my biggest expenses?', 'expenses'], ['What sells the most?', 'best'],
    ['hello', null],
  ])('%s', (q, intent) => expect(detectIntent(q)).toBe(intent));
});
