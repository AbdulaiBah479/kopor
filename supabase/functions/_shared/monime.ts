// Minimal Monime API client (https://docs.monime.io, API version caph.2025-08-23).
import { HttpError, admin, unseal } from './util.ts';

const BASE = 'https://api.monime.io/v1';

export interface MonimeCreds { spaceId: string; token: string }

export async function credsFor(orgId: string): Promise<MonimeCreds> {
  const { data } = await admin().from('org_secrets').select('monime_space_id, monime_token_enc').eq('org_id', orgId).maybeSingle();
  if (!data?.monime_space_id || !data.monime_token_enc) throw new HttpError(400, 'Monime is not connected for this business');
  return { spaceId: data.monime_space_id, token: await unseal(data.monime_token_enc) };
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
