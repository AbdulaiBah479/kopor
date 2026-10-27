// Kopor Pro. Actions:
//   { orgId, months: 1 | 12 }      -> checkout on KOPOR's own Monime account (env KOPOR_MONIME_SPACE_ID / KOPOR_MONIME_TOKEN);
//                                     the webhook upgrades the business when Monime confirms the payment.
//   { orgId, action: 'trial' }     -> 14 days of Pro free, once per business (owner only).
//   { action: 'status' }           -> whether paying for Pro is open yet.
import { admin, caller, cors, json, requireLevel, HttpError, nowMs } from '../_shared/util.ts';
import { monime, SLE } from '../_shared/monime.ts';

const DAY = 86_400_000, TRIAL_DAYS = 14;
const platform = () => {
  const spaceId = Deno.env.get('KOPOR_MONIME_SPACE_ID'), token = Deno.env.get('KOPOR_MONIME_TOKEN');
  return spaceId && token ? { spaceId, token } : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'status') return json({ payments: !!platform(), trialDays: TRIAL_DAYS });
    const orgId = String(body.orgId ?? '');
    if (!/^[0-9a-f-]{36}$/.test(orgId)) throw new HttpError(400, 'Bad request');
    const { level } = await caller(req, orgId);
    requireLevel(level, 3);
    const db = admin();

    if (body.action === 'trial') {
      const { data: org } = await db.from('orgs').select('plan, plan_until, pro_trial_at').eq('id', orgId).single();
      if (org?.pro_trial_at) throw new HttpError(409, 'errx.trialUsed');
      const until = Math.max(nowMs(), Number(org?.plan_until ?? 0)) + TRIAL_DAYS * DAY;
      const { error } = await db.from('orgs').update({ plan: 'pro', plan_until: until, pro_trial_at: new Date().toISOString(), updated_at: nowMs() }).eq('id', orgId);
      if (error) throw new Error(error.message);
      return json({ ok: true, until });
    }

    const p = platform();
    if (!p) throw new HttpError(503, 'errx.proNotReady');
    const months = body.months === 12 ? 12 : 1;
    const monthly = Number(Deno.env.get('PRO_PRICE_MINOR') ?? 7500);
    const amount = months === 12 ? monthly * 10 : monthly; // yearly = 2 months free
    const requestId = crypto.randomUUID();
    const appUrl = Deno.env.get('PUBLIC_APP_URL');
    const session = await monime<{ id: string; redirectUrl: string }>(p, 'POST', '/checkout-sessions', {
      name: `Kopor Pro · ${months} month${months > 1 ? 's' : ''}`,
      lineItems: [{ type: 'custom', name: `Kopor Pro (${months} month${months > 1 ? 's' : ''})`, price: SLE(amount), quantity: 1 }],
      ...(appUrl ? { successUrl: `${appUrl}#/plan`, cancelUrl: `${appUrl}#/plan` } : {}),
      brandingOptions: { primaryColor: '#0b7a3b' },
      metadata: { kind: 'subscription', orgId, months: String(months), requestId },
    }, `pro-${orgId}-${requestId}`);
    await db.from('payment_requests').insert({
      id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'checkout', amount, status: 'pending',
      provider_ref: session.id, url: session.redirectUrl, note: `Kopor Pro ${months}m`,
    });
    return json({ url: session.redirectUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
