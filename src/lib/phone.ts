// Phone helpers. Sierra Leone numbers look like 076 123456 → +232 76 123456.
export function intlPhone(phone: string | null | undefined, cc = '232'): string {
  const d = String(phone ?? '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith(cc) && d.length > 9) return d;
  if (d.startsWith('0')) return cc + d.slice(1);
  return cc + d;
}
export const isValidPhone = (p: string, cc = '232') => /^\d{10,15}$/.test(intlPhone(p, cc));
export const waLink = (phone: string | null | undefined, text: string, cc?: string) =>
  `https://wa.me/${intlPhone(phone, cc)}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone: string | null | undefined, text: string, cc?: string) =>
  `sms:+${intlPhone(phone, cc)}?body=${encodeURIComponent(text)}`;
export const telLink = (phone: string | null | undefined, cc?: string) => `tel:+${intlPhone(phone, cc)}`;
