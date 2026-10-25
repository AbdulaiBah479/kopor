// Pure helpers for the shop-phone SMS gateway (no Deno APIs, so the unit tests check them too).
/** HMAC-SHA256 of the raw body + timestamp, as hex (how the app signs webhooks). */
export async function signature(key: string, rawBody: string, timestamp: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(rawBody + timestamp));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** "Le 1,250.00" for a text message (minor units in, Leones out). */
export const leones = (minor: number) => `Le ${(Math.round(minor) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
