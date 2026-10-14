import { describe, expect, it } from 'vitest';
import { evaluate, hasOperator } from '@/lib/calc';

describe('calculator', () => {
  it.each([
    ['300', 300], ['300+250', 550], ['1,200-150', 1050], ['12x50', 600], ['12×50+10', 610], ['10+2*3', 16],
    ['100÷4', 25], ['5k', 5000], ['2.5m', 2500000], ['0.5+0.25', 0.75], ['7-10', -3],
  ])('%s = %s', (input, out) => expect(evaluate(input)).toBe(out));

  it.each(['', '+', '5+', '5++2', 'abc', '5/0'])('rejects %j', (input) => expect(evaluate(input)).toBeNull());

  it('detects expressions', () => {
    expect(hasOperator('300+250')).toBe(true);
    expect(hasOperator('300')).toBe(false);
  });
});
