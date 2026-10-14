// Kopor Pro subscription checkout. Payments go to KOPOR's own Monime account (platform credentials in
// env KOPOR_MONIME_SPACE_ID / KOPOR_MONIME_TOKEN). The webhook upgrades the business when Monime confirms payment.
import { admin, caller, cors, json, requireLevel, HttpError, env, nowMs } from '../_shared/util.ts';
import { monime, SLE } from '../_shared/monime.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { orgId, months: m } = await req.json();
    if (!/^[0-9a-f-]{36}$/.test(String(orgId))) throw new HttpError(400, 'Bad request');
    const { level } = await caller(req, orgId);
    requireLevel(level, 3);
    const months = m === 12 ? 12 : 1;
    const monthly = Number(Deno.env.get('PRO_PRICE_MINOR') ?? 7500);
    const amount = months === 12 ? monthly * 10 : monthly; // yearly = 2 months free
    const platform = { spaceId: env('KOPOR_MONIME_SPACE_ID'), token: env('KOPOR_MONIME_TOKEN') };
    const requestId = crypto.randomUUID();
    const appUrl = Deno.env.get('PUBLIC_APP_URL');
    const session = await monime<{ id: string; redirectUrl: string }>(platform, 'POST', '/checkout-sessions', {
      name: `Kopor Pro · ${months} month${months > 1 ? 's' : ''}`,
      lineItems: [{ type: 'custom', name: `Kopor Pro (${months} month${months > 1 ? 's' : ''})`, price: SLE(amount), quantity: 1 }],
      ...(appUrl ? { successUrl: `${appUrl}#/plan`, cancelUrl: `${appUrl}#/plan` } : {}),
      brandingOptions: { primaryColor: '#0b7a3b' },
      metadata: { kind: 'subscription', orgId, months: String(months), requestId },
    }, `pro-${orgId}-${requestId}`);
    await admin().from('payment_requests').insert({
      id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'checkout', amount, status: 'pending',
      provider_ref: session.id, url: session.redirectUrl, note: `Kopor Pro ${months}m`,
    });
    return json({ url: session.redirectUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
