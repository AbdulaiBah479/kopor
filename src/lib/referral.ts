// "Invite a shop": an invite link looks like https://…/#/?ref=ABC234. Opening it remembers the code on this phone,
// and once the new business is signed in to the cloud, Kopor tells the server who invited it (one time).
const KEY = 'kopor.ref';
const CODE = /^[A-Z2-9]{6}$/;

/** Remember the invite code from the address (called once at start-up). */
export function captureRef(hash = typeof location === 'undefined' ? '' : location.hash) {
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const ref = new URLSearchParams(q).get('ref')?.toUpperCase() ?? '';
  if (CODE.test(ref)) { try { localStorage.setItem(KEY, ref); } catch { /* private mode */ } }
}
export const storedRef = (): string | null => { try { const r = localStorage.getItem(KEY); return r && CODE.test(r) ? r : null; } catch { return null; } };
export const clearRef = () => { try { localStorage.removeItem(KEY); } catch { /* private mode */ } };
export const inviteLink = (base: string, code: string) => `${base.replace(/\/?$/, '/')}#/?ref=${code}`;
