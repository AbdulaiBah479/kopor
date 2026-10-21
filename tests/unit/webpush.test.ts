// The push encryption must match the RFC 8291 example byte for byte, or no phone could read our notifications.
import { describe, expect, it } from 'vitest';
import { b64u, unb64u, encryptPayload, generateVapidKeys, vapidHeader } from '../../supabase/functions/_shared/webpush';

describe('web push (RFC 8291 / RFC 8292)', () => {
  it('encrypts the RFC 8291 example exactly', async () => {
    const body = await encryptPayload(
      unb64u('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      {
        asPublic: unb64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
        asPrivate: unb64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
        salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'),
      },
    );
    expect(b64u(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
      'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
      'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });

  it('makes a VAPID header whose signature verifies with the public key', async () => {
    const keys = await generateVapidKeys();
    expect(unb64u(keys.publicKey)).toHaveLength(65);
    const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:support@kopor.app', 1_800_000_000);
    const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'mailto:support@kopor.app' });
    const pub = await crypto.subtle.importKey('raw', unb64u(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});
