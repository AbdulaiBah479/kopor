// Minimal Monime API client (https://docs.monime.io, API version caph.2025-08-23).
import { HttpError, admin, unseal, nowMs } from './util.ts';

const BASE = 'https://api.monime.io/v1';

/** fac: easy payments, the business's own money box inside Kopor's Monime account (every call is limited to it). */
export interface MonimeCreds { spaceId: string; token: string; fac?: string }

/** Kopor's own Monime account (Kopor Pro billing and easy payments). */
export function platformCreds(): MonimeCreds {
  const spaceId = Deno.env.get('KOPOR_MONIME_SPACE_ID'), token = Deno.env.get('KOPOR_MONIME_TOKEN');
  if (!spaceId || !token) throw new HttpError(503, 'Easy payments are not switched on yet');
  return { spaceId, token };
}

/** Easy payments are offered once Kopor's Monime account is set up and the owner switches them on (KOPOR_EASY_PAY=on). */
export const easyAvailable = () => Deno.env.get('KOPOR_EASY_PAY') === 'on' && !!Deno.env.get('KOPOR_MONIME_SPACE_ID') && !!Deno.env.get('KOPOR_MONIME_TOKEN');

/** The business's own Monime account if it connected one; otherwise its money box in Kopor's account (easy payments). */
export async function credsFor(orgId: string): Promise<MonimeCreds> {
  const { data } = await admin().from('org_secrets').select('monime_space_id, monime_token_enc, easy_fac_id, easy_on').eq('org_id', orgId).maybeSingle();
  if (data?.monime_space_id && data.monime_token_enc) return { spaceId: data.monime_space_id, token: await unseal(data.monime_token_enc) };
  if (data?.easy_on && data.easy_fac_id) return { ...platformCreds(), fac: data.easy_fac_id };
  throw new HttpError(400, 'Monime is not connected for this business');
}

/** Where collected money settles: the business's money box (easy payments) or the account's main box. */
export const settleTo = (c: MonimeCreds) => (c.fac ? { financialAccountId: c.fac } : {});

/**
 * Easy payments: send everything in the business's money box on to the owner's mobile money number.
 * Monime adds its payout fee on top of the amount, so if the full balance is refused, a little is left to cover it.
 * Safe to call again: the same key never pays twice, and a failure leaves the money in the box for the next try.
 */
export async function sweepToOwner(orgId: string, key: string): Promise<{ sent: number; status: string } | null> {
  const db = admin();
  const { data: s } = await db.from('org_secrets').select('easy_fac_id, payout_phone, payout_provider, easy_on').eq('org_id', orgId).maybeSingle();
  if (!s?.easy_on || !s.easy_fac_id || !s.payout_phone || !/^m\d+$/.test(s.payout_provider ?? '')) return null;
  const c = { ...platformCreds(), fac: s.easy_fac_id };
  const acc = await monime<{ balance?: { available?: { value: number } } | null }>(c, 'GET', `/financial-accounts/${encodeURIComponent(s.easy_fac_id)}?withBalance=true`);
  const balance = acc.balance?.available?.value ?? 0;
  if (balance < 100) return null; // under Le 1: wait for more
  let last: unknown;
  for (const [i, amount] of [balance, Math.floor(balance * 0.98), Math.floor(balance * 0.95)].entries()) {
    const requestId = crypto.randomUUID();
    try {
      const p = await monime<{ id: string; status: string }>(c, 'POST', '/payouts', {
        amount: SLE(amount), source: { financialAccountId: s.easy_fac_id },
        destination: { type: 'momo', providerId: s.payout_provider, phoneNumber: s.payout_phone },
        metadata: { orgId, requestId, note: 'Sent to your mobile money' },
      }, `sweep-${key}-${i}`);
      await db.from('payment_requests').insert({
        id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'payout', amount, status: p.status ?? 'pending',
        provider_ref: p.id, phone: s.payout_phone, note: 'Sent to your mobile money',
      });
      return { sent: amount, status: p.status ?? 'pending' };
    } catch (e) { last = e; }
  }
  console.error('sweep failed', orgId, last);
  return null;
}

export async function monime<T = Record<string, unknown>>(c: MonimeCreds, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Monime-Space-Id': c.spaceId,
      'Monime-Version': 'caph.2025-08-23',
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 64) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    const msg = j?.error?.message ?? j?.messages?.[0]?.message ?? j?.messages?.[0] ?? `Monime error ${res.status}`;
    throw new HttpError(502, String(msg));
  }
  return j.result as T;
}

export const SLE = (minor: number) => ({ currency: 'SLE', value: Math.round(minor) });

/** GET a list endpoint and return one page plus the cursor for the next page (null at the end). */
export async function monimeList<T>(c: MonimeCreds, path: string): Promise<{ items: T[]; next: string | null }> {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${c.token}`, 'Monime-Space-Id': c.spaceId, 'Monime-Version': 'caph.2025-08-23' },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new HttpError(502, String(j?.error?.message ?? j?.messages?.[0]?.message ?? `Monime error ${res.status}`));
  return { items: (j.result ?? []) as T[], next: j.pagination?.next ?? null };
}
