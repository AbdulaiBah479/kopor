import { describe, expect, it } from 'vitest';
import { parseMoney, formatMoney, formatShort } from '@/lib/money';
import { intlPhone, waLink } from '@/lib/phone';
import { hashPin, verifyPin, encryptText, decryptText, refCode, uuid } from '@/lib/crypto';
import { parseLocal } from '@/ai/parser';

describe('money', () => {
  it('parses everyday inputs into cents', () => {
    expect(parseMoney('1,200.50')).toBe(120050);
    expect(parseMoney('5k')).toBe(500000);
    expect(parseMoney('Le 2.5m')).toBe(250000000);
    expect(parseMoney('abc')).toBe(0);
  });
  it('formats', () => {
    expect(formatMoney(120050)).toBe('Le 1,200.50');
    expect(formatMoney(100000)).toBe('Le 1,000');
    expect(formatMoney(-500, { sign: true })).toBe('-Le 5');
    expect(formatShort(1250000)).toBe('12.5k');
  });
});

describe('phone', () => {
  it('normalises Sierra Leone numbers', () => {
    expect(intlPhone('076 123 456')).toBe('23276123456');
    expect(intlPhone('+23276123456')).toBe('23276123456');
    expect(intlPhone('0023276123456')).toBe('23276123456');
    expect(waLink('076123456', 'Hi there')).toBe('https://wa.me/23276123456?text=Hi%20there');
  });
});

describe('crypto', () => {
  it('hashes and verifies PINs with a random salt', async () => {
    const h1 = await hashPin('1234'), h2 = await hashPin('1234');
    expect(h1).not.toBe(h2);
    expect(await verifyPin('1234', h1)).toBe(true);
    expect(await verifyPin('4321', h1)).toBe(false);
  });
  it('encrypts and decrypts', async () => {
    const blob = await encryptText('hello kopor', 'pw');
    expect(await decryptText(blob, 'pw')).toBe('hello kopor');
    await expect(decryptText(blob, 'nope')).rejects.toThrow();
  });
  it('makes stable codes and valid uuids', () => {
    expect(refCode('abc')).toBe(refCode('abc'));
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('offline parser (English + Krio)', () => {
  const known = { contacts: ['Aminata Sesay', 'Mohamed Bangura'], products: ['Rice 50kg bag', 'Palm oil 4L'] };
  it.each([
    ['Sold 3 bags rice 2550 orange money', 'sale', 255000, 'orange'],
    ['Aminata took 2 tins palm oil 360 on credit', 'credit_given', 36000, 'cash'],
    ['Mohamed don pay 250', 'payment_received', 25000, 'cash'],
    ['Spent 120 on transport', 'expense', 12000, 'cash'],
    ['A sel 2 bag rice 1,700', 'sale', 170000, 'cash'],
    ['Paid 5k for shop rent', 'expense', 500000, 'cash'],
  ])('%s', (text, action, amount, method) => {
    const r = parseLocal(text, known);
    expect(r.action).toBe(action);
    expect(r.amount).toBe(amount);
    expect(r.method).toBe(method);
  });
  it('finds people and products', () => {
    const r = parseLocal('Aminata took 2 tins palm oil 360 on credit', known);
    expect(r.name).toBe('Aminata Sesay');
    expect(r.item).toBe('Palm oil 4L');
    expect(r.qty).toBe(2);
    expect(parseLocal('Spent 120 on transport', known).category).toBe('transport');
  });
});
