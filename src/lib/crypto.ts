// Security primitives built on WebCrypto: ids, PIN hashing (PBKDF2) and backup encryption (AES-GCM).
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for older Android WebViews: RFC 4122 v4 from secure random bytes.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const PIN_ITERATIONS = 150_000;

/** Returns "pbkdf2$iterations$salt$hash". */
export async function hashPin(pin: string, salt = randomBytes(16), iterations = PIN_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  const again = await hashPin(pin, unb64(salt), Number(iter));
  return timingSafeEqual(again.split('$')[3], hash);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function aesKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface EncryptedBlob { kopor: 'encrypted-backup'; v: 1; salt: string; iv: string; data: string }

export async function encryptText(text: string, passphrase: string): Promise<EncryptedBlob> {
  const salt = randomBytes(16), iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(passphrase, salt), enc.encode(text));
  return { kopor: 'encrypted-backup', v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function decryptText(blob: EncryptedBlob, passphrase: string): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, await aesKey(passphrase, unb64(blob.salt)), unb64(blob.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Wrong password or damaged backup file');
  }
}

/** Short human-checkable code (FNV-1a) for invoices and reports. */
export function refCode(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

/** URL-safe random token for public invoice links. */
export const randomToken = (bytes = 18) => b64(randomBytes(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
