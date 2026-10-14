// Kopor ⇄ Monime payments. Each business connects its OWN Monime account; Kopor never holds funds.
// Actions: connect | status | disconnect | checkout | ussd | providers | payout
import { admin, caller, cors, json, requireLevel, seal, HttpError, env, nowMs, randomSecret } from '../_shared/util.ts';
import { credsFor, monime, SLE, type MonimeCreds } from '../_shared/monime.ts';

const LEVEL = { connect: 3, disconnect: 3, status: 0, checkout: 2, ussd: 2, providers: 3, payout: 3 } as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const action = body.action as keyof typeof LEVEL;
    const orgId = String(body.orgId ?? '');
    if (!(action in LEVEL) || !/^[0-9a-f-]{36}$/.test(orgId)) throw new HttpError(400, 'Bad request');
    const { level } = await caller(req, orgId);
    requireLevel(level, LEVEL[action]);
    const db = admin();

    switch (action) {
      case 'connect': {
        const spaceId = String(body.spaceId ?? ''), token = String(body.token ?? '');
        if (!/^spc-/.test(spaceId) || token.length < 10) throw new HttpError(400, 'Invalid Monime credentials');
        const creds: MonimeCreds = { spaceId, token };
        // Verify the credentials work before saving them.
        await monime(creds, 'GET', '/momos?country=SL&limit=1');
        const secret = randomSecret();
        await monime(creds, 'POST', '/webhooks', {
          name: 'Kopor', url: `${env('SUPABASE_URL')}/functions/v1/monime-webhook`, apiRelease: 'caph', enabled: true,
          events: ['payment_code.completed', 'payment_code.expired', 'checkout_session.completed', 'checkout_session.expired', 'checkout_session.cancelled', 'payout.completed', 'payout.failed'],
          headers: { 'x-kopor-secret': secret }, verificationMethod: { type: 'HS256', secret: randomSecret(48) }, metadata: { orgId },
        }, `kopor-webhook-${orgId}-${Date.now()}`);
        await db.from('org_secrets').upsert({ org_id: orgId, monime_space_id: spaceId, monime_token_enc: await seal(token), webhook_secret: secret, updated_at: new Date().toISOString() });
        return json({ ok: true });
      }
      case 'status': {
        const { data } = await db.from('org_secrets').select('monime_space_id').eq('org_id', orgId).maybeSingle();
        return json({ connected: !!data?.monime_space_id });
      }
      case 'disconnect': {
        await db.from('org_secrets').update({ monime_space_id: null, monime_token_enc: null }).eq('org_id', orgId);
        return json({ ok: true });
      }
      case 'providers': {
        const list = await monime<{ providerId: string; name: string; status: { active: boolean }; featureSet?: { payout?: { canPayTo?: boolean } } }[]>(await credsFor(orgId), 'GET', '/momos?country=SL&limit=50');
        return json({ providers: (list ?? []).filter((m) => m.status?.active !== false).map((m) => ({ id: m.providerId, name: m.name })) });
      }
      case 'checkout': {
        const { data: inv } = await db.from('invoices').select('*').eq('id', body.invoiceId).eq('org_id', orgId).maybeSingle();
        if (!inv || inv.status !== 'unpaid') throw new HttpError(400, 'Invoice not found or already paid');
        const { data: org } = await db.from('orgs').select('name').eq('id', orgId).single();
        const items = inv.items as { name: string; qty: number; price: number }[];
        const itemsSum = items.reduce((s, i) => s + i.qty * i.price, 0);
        const total = Number(inv.total ?? itemsSum);
        // Itemised checkout only when the items add up exactly (no discount or added tax); otherwise one line for the total.
        const simple = total === itemsSum && items.length <= 16 && items.every((i) => Number.isInteger(i.qty) && i.qty >= 1 && i.price > 0);
        const lineItems = simple
          ? items.map((i) => ({ type: 'custom', name: i.name.slice(0, 100), price: SLE(i.price), quantity: i.qty }))
          : [{ type: 'custom', name: `Invoice ${inv.number}`, price: SLE(total), quantity: 1 }];
        const requestId = crypto.randomUUID();
        const appUrl = Deno.env.get('PUBLIC_APP_URL');
        const session = await monime<{ id: string; redirectUrl: string }>(await credsFor(orgId), 'POST', '/checkout-sessions', {
          name: `${org!.name} · ${inv.number}`.slice(0, 150), lineItems, reference: inv.number,
          ...(appUrl ? { successUrl: `${appUrl}#/i/${inv.public_token}`, cancelUrl: `${appUrl}#/i/${inv.public_token}` } : {}),
          brandingOptions: { primaryColor: '#0b7a3b' }, metadata: { orgId, invoiceId: inv.id, requestId },
        }, `checkout-${inv.id}-${Math.floor(Date.now() / 600000)}`);
        await db.from('payment_requests').insert({
          id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'checkout', invoice_id: inv.id, amount: total,
          status: 'pending', provider_ref: session.id, url: session.redirectUrl, note: inv.number,
        });
        return json({ url: session.redirectUrl, requestId });
      }
      case 'ussd': {
        const amount = Math.round(Number(body.amount));
        if (!(amount > 0)) throw new HttpError(400, 'Invalid amount');
        const requestId = crypto.randomUUID();
        const name = String(body.name ?? 'Kopor payment').padEnd(3, ' ').slice(0, 64);
        const code = await monime<{ id: string; ussdCode: string }>(await credsFor(orgId), 'POST', '/payment-codes', {
          name, mode: 'one_time', amount: SLE(amount), duration: '24h', reference: requestId.slice(0, 64),
          metadata: { orgId, requestId, ...(body.invoiceId ? { invoiceId: String(body.invoiceId) } : {}), ...(body.groupId ? { groupId: String(body.groupId) } : {}) },
        }, `ussd-${requestId}`);
        await db.from('payment_requests').insert({
          id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'ussd', invoice_id: body.invoiceId ?? null, group_id: body.groupId ?? null,
          amount, status: 'pending', provider_ref: code.id, ussd_code: code.ussdCode, phone: body.phone ?? null, note: name,
        });
        return json({ ussdCode: code.ussdCode, requestId });
      }
      case 'payout': {
        const amount = Math.round(Number(body.amount));
        const phone = String(body.phone ?? '').replace(/[^\d+]/g, '');
        if (!(amount > 0) || phone.length < 8 || !/^m\d+$/.test(String(body.providerId))) throw new HttpError(400, 'Invalid payout');
        const requestId = crypto.randomUUID();
        const p = await monime<{ id: string; status: string }>(await credsFor(orgId), 'POST', '/payouts', {
          amount: SLE(amount), destination: { type: 'momo', providerId: body.providerId, phoneNumber: phone },
          metadata: { orgId, requestId, ...(body.groupId ? { groupId: String(body.groupId) } : {}) },
        }, `payout-${requestId}`);
        await db.from('payment_requests').insert({
          id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'payout', group_id: body.groupId ?? null, amount,
          status: p.status ?? 'pending', provider_ref: p.id, phone, note: String(body.note ?? '').slice(0, 200),
        });
        return json({ status: p.status, requestId });
      }
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Server error' }, status);
  }
});
