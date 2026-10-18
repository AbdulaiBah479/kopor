// One-time PIN recovery codes, shared by the recover function (users) and the admin function (support).
// Only a salted SHA-256 hash of a code is ever stored.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read and type

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
export const hashCode = (salt: string, code: string) => sha256(`${salt}:${code}`);
export const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
export function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(10));
  // 32 symbols = exactly 5 bits, so masking a random byte picks each symbol with equal probability (no modulo bias).
  const s = [...r].map((x) => ALPHABET[x & 31]).join('');
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
/** Key of an account's wrong-PIN lock in pin_attempts. */
export const lockKey = async (email: string) => 'acct:' + await sha256(email.toLowerCase());

// deno-lint-ignore no-explicit-any
type Db = any;
/** Make a fresh code for this account (replacing any old one) and return it. */
export async function issueCode(db: Db, userId: string): Promise<string> {
  const code = newCode(), salt = crypto.randomUUID();
  const { error } = await db.from('recovery_codes').upsert({ user_id: userId, code_hash: await hashCode(salt, normalize(code)), salt, attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return code;
}
