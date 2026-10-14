// Small shared helpers: ids, escaping, money, dates, phones.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().toLowerCase().replace(/,/g, '');
  let mult = 1;
  if (/k$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
  else if (/m$/.test(s)) { mult = 1e6; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return isFinite(n) ? n * mult : 0;
}

let CUR = 'Le';
export const setCurrency = (c) => { CUR = c || 'Le'; };
export const currency = () => CUR;
export function money(n, { sign = false } = {}) {
  const v = round2(n);
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const pre = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  return `${pre}${CUR} ${s}`;
}
// Compact form for chart axes: Le 12.5k
export function moneyShort(n) {
  const v = Math.abs(n);
  const s = v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'm' : v >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v));
  return (n < 0 ? '-' : '') + s;
}

// Dates are stored as local YYYY-MM-DD strings so they sort and compare as text.
export function isoDate(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}
export const today = () => isoDate();
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function addMonths(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setMonth(d.getMonth() + n);
  return isoDate(d);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function relDate(iso) {
  const t = today();
  if (iso === t) return 'Today';
  if (iso === addDays(t, -1)) return 'Yesterday';
  return fmtDate(iso);
}
export const monthLabel = (iso) => { const [y, m] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const weekday = (iso) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso + 'T12:00:00').getDay()];

export function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
}

// Turn local numbers like 076 123456 into international 23276123456.
export function intlPhone(phone, cc = '232') {
  let d = String(phone || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith(cc)) return d;
  if (d.startsWith('0')) return cc + d.slice(1);
  return cc + d;
}
export const waLink = (phone, text, cc) => `https://wa.me/${intlPhone(phone, cc)}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone, text, cc) => `sms:+${intlPhone(phone, cc)}?body=${encodeURIComponent(text)}`;
export const telLink = (phone, cc) => `tel:+${intlPhone(phone, cc)}`;

// Short, stable reference code (FNV-1a) used to verify invoices and reports.
export function refCode(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

export async function sha256(text) {
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return refCode(text);
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
