// Web Push with no paid service and no third-party library: VAPID (RFC 8292) and message encryption (RFC 8291,
// aes128gcm per RFC 8188), using only the standard Web Crypto API. Works in Deno (Edge Functions) and in Node (tests).
// The encryption is checked byte for byte against the RFC 8291 example in tests/unit/webpush.test.ts.

const enc = new TextEncoder();
// Byte arrays backed by a plain ArrayBuffer (what Web Crypto accepts).
type Bytes = Uint8Array<ArrayBuffer>;
const text = (s: string): Bytes => enc.encode(s) as Bytes;

export const b64u = (b: Bytes) => {
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string): Bytes => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hmac(key: Bytes, data: Bytes) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
/** P-256 private key from its raw 32-byte d and 65-byte uncompressed public key. */
const privateJwk = (d: Bytes, pub: Bytes) => ({ kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true });

export interface VapidKeys { publicKey: string; privateKey: string } // base64url: 65-byte public point, 32-byte d

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64u(pub), privateKey: jwk.d! };
}

/** "Authorization: vapid t=…, k=…" for a push service (the JWT is valid for 12 hours). */
export async function vapidHeader(endpoint: string, keys: VapidKeys, subject: string, now = Math.floor(Date.now() / 1000)) {
  const header = b64u(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(text(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', privateJwk(unb64u(keys.privateKey), unb64u(keys.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Web Crypto returns the raw r||s signature, which is exactly what JWS ES256 uses.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/**
 * Encrypt one message for a browser subscription (RFC 8291). `fixed` is only for the RFC test vector: a known sender key
 * pair and salt instead of fresh random ones.
 */
export async function encryptPayload(plaintext: Bytes, p256dh: string, auth: string,
  fixed?: { asPublic: Bytes; asPrivate: Bytes; salt: Bytes }) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  let asPublic: Bytes, asKey: CryptoKey;
  if (fixed) {
    asPublic = fixed.asPublic;
    asKey = await crypto.subtle.importKey('jwk', privateJwk(fixed.asPrivate, fixed.asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    asKey = kp.privateKey;
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKey, 256));
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(text('WebPush: info\0'), uaPublic, asPublic);
  const ikm = (await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(text('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(text('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // single record: delimiter 0x02, no padding
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }

/** Send one notification. Returns the push service's HTTP status (404/410 = the subscription is gone; delete it). */
export async function sendPush(sub: PushSubscriptionKeys, message: unknown, keys: VapidKeys, subject: string, ttl = 24 * 3600) {
  const body = await encryptPayload(text(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, keys, subject), 'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal',
    },
    body,
  });
  return res.status;
}
