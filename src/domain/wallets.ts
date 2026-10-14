// Mobile money numbers and pay-me links. Kopor never moves money itself without a licensed partner (Monime):
// it shows customers where to pay, opens the network's own menu for sending, and records what happened.
import type { Org } from '@/db/schema';

export type Network = 'orange' | 'afrimoney' | 'qmoney';
export const NETWORKS: Network[] = ['orange', 'afrimoney', 'qmoney'];
export const NETWORK_NAME: Record<Network, string> = { orange: 'Orange Money', afrimoney: 'Afrimoney', qmoney: 'QMoney' };
/** Menu codes confirmed for Sierra Leone (Orange Money *144#, Afrimoney *161#). QMoney's is not published, so none is guessed. */
export const DIAL_CODE: Record<Network, string> = { orange: '*144#', afrimoney: '*161#', qmoney: '' };

export type Wallets = Partial<Record<Network, string>>;

const MATCH: [Network, RegExp][] = [['orange', /orange/i], ['afrimoney', /afri/i], ['qmoney', /q\s*-?money|qcell/i]];

/** Read the numbers back from the business's mobile money field ("Orange Money 076 123 456 · Afrimoney 077…"). */
export function parseWallets(text: string): Wallets {
  const out: Wallets = {};
  for (const part of text.split(/[·,;|\n]+/)) {
    const num = part.replace(/[^\d+]/g, '');
    if (num.length < 6) continue;
    const net = MATCH.find(([, re]) => re.test(part))?.[0] ?? (Object.keys(out).length ? undefined : 'orange');
    if (net && !out[net]) out[net] = num;
  }
  return out;
}

/** Store numbers in the existing mobile money field so invoices, reminders and receipts show them automatically. */
export const formatWallets = (w: Wallets) => NETWORKS.filter((n) => w[n]?.trim()).map((n) => `${NETWORK_NAME[n]} ${w[n]!.trim()}`).join(' · ');

export const walletsOf = (org: Pick<Org, 'momo_number'>) => parseWallets(org.momo_number ?? '');

/** tel: link that opens the network's USSD menu (# must be encoded). */
export const dialLink = (code: string) => `tel:${code.replace(/#/g, '%23')}`;

/* Pay-me links: everything the payer needs is inside the link itself, so they work without an account or internet on the
   business side. Format: base64url(JSON). */
export interface PayRequest { b: string; a: number; c: string; r?: string; w: [Network, string][] }

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));

export const encodePayRequest = (p: PayRequest) => b64url(JSON.stringify(p));

export function decodePayRequest(data: string): PayRequest | null {
  try {
    const p = JSON.parse(unb64url(data));
    if (typeof p?.b !== 'string' || !Number.isFinite(p.a) || p.a < 0 || !Array.isArray(p.w)) return null;
    const w = (p.w as unknown[]).filter((x): x is [Network, string] => Array.isArray(x) && NETWORKS.includes(x[0] as Network) && /^\+?\d{6,15}$/.test(String(x[1])));
    return { b: p.b.slice(0, 80), a: Math.round(p.a), c: String(p.c ?? 'Le').slice(0, 6), r: typeof p.r === 'string' ? p.r.slice(0, 120) : undefined, w };
  } catch { return null; }
}

/** Public link to the pay page (works from the published web app). */
export function payLink(p: PayRequest) {
  const base = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || `${location.origin}${location.pathname}`;
  return `${base.replace(/#.*$/, '')}#/pay/${encodePayRequest(p)}`;
}
