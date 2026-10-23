// Sierra Leone mobile money numbers: tidy what people type and tell which network it is.
// Plain TypeScript (no Deno APIs) so the unit tests can check it too.

// Monime provider ids: m17 = Orange Money, m18 = Afrimoney (Africell).
const NETWORKS: Record<string, 'm17' | 'm18'> = {
  '72': 'm17', '73': 'm17', '75': 'm17', '76': 'm17', '78': 'm17', '79': 'm17',
  '30': 'm18', '33': 'm18', '34': 'm18', '77': 'm18', '88': 'm18', '99': 'm18',
}; // other prefixes: the owner picks the network

/** "076 123 456", "+232 76 123456", "23276123456" -> "+23276123456"; null if it is not a Sierra Leone mobile number. */
export function normalizeSlPhone(input: string): string | null {
  let d = String(input).replace(/[^\d]/g, '');
  if (d.startsWith('00232')) d = d.slice(5);
  else if (d.startsWith('232')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^\d{8}$/.test(d) ? `+232${d}` : null;
}

/** The mobile money network for a number (from its first two digits), or null if Monime does not serve it. */
export function networkOf(phone: string): 'm17' | 'm18' | null {
  const n = normalizeSlPhone(phone);
  return n ? NETWORKS[n.slice(4, 6)] ?? null : null;
}

/** "+23276123456" -> "076 *** 456": enough for the owner to recognise it, not enough to copy it. */
export const maskPhone = (phone: string) => (phone.length >= 12 ? `0${phone.slice(4, 6)} *** ${phone.slice(-3)}` : '***');
