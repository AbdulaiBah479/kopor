import { describe, expect, it } from 'vitest';
import { payTokenOf } from '@/domain/payLink';

const T = 'a'.repeat(16) + '0123456789abcdef';

describe('payTokenOf', () => {
  it('reads the token from a scanned poster link', () => {
    expect(payTokenOf(`https://abdulaibah479.github.io/kopor/#/shop-pay/${T}`)).toBe(T);
    expect(payTokenOf(`  https://x.example/#/shop-pay/${T}?ref=qr `)).toBe(T);
  });
  it('accepts the bare code', () => expect(payTokenOf(T)).toBe(T));
  it('rejects anything that is not a Kopor pay link', () => {
    expect(payTokenOf('https://evil.example/pay')).toBeNull();
    expect(payTokenOf(`#/shop-pay/${T.slice(0, 20)}`)).toBeNull();
    expect(payTokenOf(`#/shop-pay/${T}ZZ`)).toBeNull();
    expect(payTokenOf('')).toBeNull();
  });
});
