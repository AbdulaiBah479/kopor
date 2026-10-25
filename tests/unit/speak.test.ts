import { describe, expect, it } from 'vitest';
import { canSpeak, sayMoney, speak } from '@/lib/speak';

describe('reading aloud', () => {
  it('says money the way people say it', () => {
    expect(sayMoney('Le 1,500')).toBe('1,500 Leones');
    expect(sayMoney('Le 12.50')).toBe('12.50 Leones');
  });
  it('stays silent where the phone has no voice', async () => {
    expect(canSpeak()).toBe(false);
    await expect(speak('Hello')).resolves.toBeUndefined();
  });
});
