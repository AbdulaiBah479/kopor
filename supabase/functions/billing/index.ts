// Kopor Pro. Actions:
//   { orgId, months: 1 | 12 }      -> checkout on KOPOR's own Monime account (env KOPOR_MONIME_SPACE_ID / KOPOR_MONIME_TOKEN);
//                                     the webhook upgrades the business when Monime confirms the payment.
//   { orgId, action: 'trial' }     -> 14 days of Pro free, once per business (owner only).
//   { action: 'status' }           -> whether paying for Pro is open yet.
//   { orgId, action: 'referral', join? } -> this business's invite code, rewards earned (30 days of Pro each), and
//                                     optionally the code of the business that invited it (owner only).
import { admin, caller, cors, json, requireLevel, HttpError, nowMs } from '../_shared/util.ts';
import { ensurePlatformWebhook, monime, SLE } from '../_shared/monime.ts';

const DAY = 86_400_000, TRIAL_DAYS = 14;
const platform = () => {
  const spaceId = Deno.env.get('KOPOR_MONIME_SPACE_ID'), token = Deno.env.get('KOPOR_MONIME_TOKEN');
  return spaceId && token ? { spaceId, token } : null;
};

// Invite a shop, get a free month: the inviter gets 30 days of Pro for each invited business that has really used
// Kopor (records on 7 different days), at most 24 times. A business can name who invited it once, in its first 30 days,
// and never itself or another business of the same owner.
const REF_DAYS = 7, REF_MAX = 24, JOIN_WINDOW = 30 * DAY;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read out
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('');

async function referral(orgId: string, join: string | null) {
  const db = admin();
  const { data: org } = await db.from('orgs').select('id, created_at, owner_user_id, ref_code, referred_by, plan, plan_until').eq('id', orgId).single();
  if (!org) throw new HttpError(404, 'Not found');
  let code = org.ref_code as string | null;
  for (let i = 0; !code && i < 5; i++) {
    const c = newCode();
    const { error } = await db.from('orgs').update({ ref_code: c }).eq('id', orgId).is('ref_code', null);
    if (!error) code = c;
  }
  let joined = org.referred_by as string | null;
  if (join) {
    const want = join.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (joined) throw new HttpError(409, 'errx.refAlready');
    if (nowMs() - Number(org.created_at) > JOIN_WINDOW) throw new HttpError(409, 'errx.refTooLate');
    const { data: inviter } = await db.from('orgs').select('id, owner_user_id').eq('ref_code', want).eq('deleted', 0).maybeSingle();
    if (!inviter) throw new HttpError(404, 'errx.refUnknown');
    if (inviter.id === orgId || (inviter.owner_user_id && inviter.owner_user_id === org.owner_user_id)) throw new HttpError(409, 'errx.refSelf');
    await db.from('orgs').update({ referred_by: inviter.id }).eq('id', orgId).is('referred_by', null);
    joined = inviter.id;
  }
  // Rewards earned since last time.
  const { data: invited } = await db.from('orgs').select('id').eq('referred_by', orgId).eq('deleted', 0).limit(500);
  const { data: done } = await db.from('referral_rewards').select('invited_org').eq('inviter', orgId);
  const paid = new Set((done ?? []).map((r) => r.invited_org));
  let rewarded = paid.size, pending = 0, added = 0;
  for (const o of invited ?? []) {
    if (paid.has(o.id)) continue;
    const { data: days } = await db.rpc('kopor_active_days', { target: o.id });
    if (Number(days) < REF_DAYS || rewarded >= REF_MAX) { pending++; continue; }
    const { error } = await db.from('referral_rewards').insert({ invited_org: o.id, inviter: orgId }); // primary key: never twice
    if (!error) { rewarded++; added++; }
  }
  let until = Number(org.plan_until ?? 0);
  if (added) {
    until = Math.max(nowMs(), until) + added * 30 * DAY;
    await db.from('orgs').update({ plan: 'pro', plan_until: until, updated_at: nowMs() }).eq('id', orgId);
  }
  return { code, invited: (invited ?? []).length, rewarded, pending, added, joined: !!joined, canJoin: !joined && nowMs() - Number(org.created_at) <= JOIN_WINDOW, until };
}

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

    if (body.action === 'referral') return json(await referral(orgId, typeof body.join === 'string' ? body.join : null));

    const p = platform();
    if (!p) throw new HttpError(503, 'errx.proNotReady');
    // Without the webhook, Monime could never tell Kopor the payment arrived.
    await ensurePlatformWebhook(p);
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
