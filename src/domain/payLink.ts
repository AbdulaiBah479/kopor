// A Kopor shop's pay link (from its QR poster): https://…/#/shop-pay/<token>, or the bare token.
const TOKEN = /^[0-9a-f]{32,80}$/;

/** The shop's pay token from a scanned QR, a pasted link or a typed code; null if it is not a Kopor pay link. */
export function payTokenOf(text: string): string | null {
  const s = text.trim();
  if (TOKEN.test(s)) return s;
  const m = /#\/shop-pay\/([0-9a-f]{32,80})(?:[/?#]|$)/.exec(s);
  return m ? m[1]! : null;
}
