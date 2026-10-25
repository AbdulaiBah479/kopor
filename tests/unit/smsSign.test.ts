import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { leones, sameHex, signature } from '../../supabase/functions/_shared/smsSign';

describe('texts from the shop phone: webhook signature', () => {
  it('matches HMAC-SHA256 over the raw body + timestamp (as SMS Gateway signs it)', async () => {
    const body = '{"event":"sms:received","payload":{"message":"BAL","sender":"+23276123456"}}', ts = '1761400000', key = 'k3y-from-the-app';
    const expected = createHmac('sha256', key).update(body + ts).digest('hex');
    expect(await signature(key, body, ts)).toBe(expected);
    expect(sameHex(expected, await signature(key, body, ts))).toBe(true);
    expect(sameHex(expected, await signature(key, body + ' ', ts))).toBe(false);   // any change breaks it
    expect(sameHex(expected, await signature('other', body, ts))).toBe(false);
  });
  it('writes Leones for a text', () => {
    expect(leones(125000)).toBe('Le 1,250');
    expect(leones(1250)).toBe('Le 12.5');
  });
});
