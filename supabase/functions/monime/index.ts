// Kopor <-> Monime payments. Two ways for a business to get paid:
//  - easy: the owner only enters a mobile money number. Payments land in the business's own money box inside Kopor's
//    Monime account and are sent on to that number straight away (sweepToOwner), so money does not stay with Kopor.
//  - own: the business connects its own Monime account (Space ID + token) and the money stays there.
// Actions: easy | connect | status | disconnect | checkout | link | ussd | providers | payout | wallet | history
import { admin, caller, cors, json, requireLevel, seal, HttpError, env, nowMs, randomSecret } from '../_shared/util.ts';
import { credsFor, easyAvailable, monime, monimeList, platformCreds, settleTo, SLE, sweepToOwner, type MonimeCreds } from '../_shared/monime.ts';
import { maskPhone, networkOf, normalizeSlPhone } from '../_shared/momo.ts';

const WEBHOOK_EVENTS = ['payment_code.completed', 'payment_code.expired', 'checkout_session.completed', 'checkout_session.expired', 'checkout_session.cancelled', 'payout.completed', 'payout.failed'];

/** Kopor's own Monime account needs one webhook (shared by every easy-payments business and Kopor Pro billing). */
async function ensurePlatformWebhook(c: MonimeCreds) {
  const url = `${env('SUPABASE_URL')}/functions/v1/monime-webhook`;
  const { items } = await monimeList<{ url: string }>(c, '/webhooks?limit=50');
  if (items.some((w) => w.url === url)) return;
  await monime(c, 'POST', '/webhooks', {
    name: 'Kopor', url, apiRelease: 'caph', enabled: true, events: WEBHOOK_EVENTS,
    headers: { 'x-kopor-secret': env('KOPOR_WEBHOOK_SECRET') }, verificationMethod: { type: 'HS256', secret: randomSecret(48) }, metadata: { platform: 'kopor' },
  }, `kopor-platform-webhook-${Math.floor(Date.now() / 86_400_000)}`);
}

// wallet / history: the business's own Monime balances and money movements (managers and owners only).
const LEVEL = { easy: 3, connect: 3, disconnect: 3, status: 0, checkout: 2, link: 2, ussd: 2, providers: 3, payout: 3, wallet: 2, history: 2 } as const;

interface MonimeAccount { id: string; name: string; currency: string; uvan?: string; balance?: { available?: { currency: string; value: number } } | null }
interface MonimeTxn {
  id: string; type: 'credit' | 'debit'; amount: { currency: string; value: number }; timestamp: string; reference?: string | null;
  financialAccount?: { id: string; balance?: { after?: { value: number } | null } | null };
  originatingFee?: { code: string } | null; originatingReversal?: { originTxnId: string } | null;
  ownershipGraph?: { owner?: { type?: string; metadata?: Record<string, string> | null } | null } | null; metadata?: Record<string, string> | null;
}

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
          events: WEBHOOK_EVENTS,
          headers: { 'x-kopor-secret': secret }, verificationMethod: { type: 'HS256', secret: randomSecret(48) }, metadata: { orgId },
        }, `kopor-webhook-${orgId}-${Date.now()}`);
        await db.from('org_secrets').upsert({ org_id: orgId, monime_space_id: spaceId, monime_token_enc: await seal(token), webhook_secret: secret, updated_at: new Date().toISOString() });
        return json({ ok: true });
      }
      case 'easy': {
        // "Connect with my mobile money number": also used to change the number or switch automatic sending.
        if (!easyAvailable()) throw new HttpError(503, 'Easy payments are not switched on yet');
        const { data: cur } = await db.from('org_secrets').select('easy_fac_id, payout_phone, payout_provider').eq('org_id', orgId).maybeSingle();
        // No number given: keep the one already saved (e.g. only switching automatic sending on or off).
        const phone = body.phone ? normalizeSlPhone(String(body.phone)) : cur?.payout_phone ?? null;
        if (!phone) throw new HttpError(400, 'Enter a Sierra Leone mobile number, like 076 123 456');
        const provider = /^m1[78]$/.test(String(body.providerId ?? '')) ? String(body.providerId)
          : body.phone ? networkOf(phone) : cur?.payout_provider ?? networkOf(phone);
        if (!provider) throw new HttpError(400, 'Choose the network for this number');
        const c = platformCreds();
        let fac = cur?.easy_fac_id as string | undefined;
        if (!fac) {
          const { data: org } = await db.from('orgs').select('name').eq('id', orgId).single();
          // The reference (the business id) is unique in Kopor's Monime account, so one business never gets two boxes.
          const acc = await monime<{ id: string }>(c, 'POST', '/financial-accounts', {
            name: String(org!.name).slice(0, 100), currency: 'SLE', reference: orgId, description: 'Kopor easy payments', metadata: { orgId },
          }, `fac-${orgId}`);
          fac = acc.id;
        }
        await ensurePlatformWebhook(c);
        await db.from('org_secrets').upsert({
          org_id: orgId, easy_fac_id: fac, payout_phone: phone, payout_provider: provider, easy_on: true,
          ...(typeof body.auto === 'boolean' ? { easy_auto: body.auto } : {}), updated_at: new Date().toISOString(),
        });
        return json({ ok: true, phone: maskPhone(phone), providerId: provider });
      }
      case 'status': {
        const { data } = await db.from('org_secrets').select('monime_space_id, easy_on, easy_fac_id, payout_phone, payout_provider, easy_auto').eq('org_id', orgId).maybeSingle();
        const mode = data?.monime_space_id ? 'own' : data?.easy_on && data.easy_fac_id ? 'easy' : null;
        return json({
          connected: !!mode, mode, easyAvailable: easyAvailable(),
          ...(mode === 'easy' ? { phone: maskPhone(data!.payout_phone ?? ''), providerId: data!.payout_provider, auto: data!.easy_auto } : {}),
        });
      }
      case 'disconnect': {
        const { data } = await db.from('org_secrets').select('monime_space_id').eq('org_id', orgId).maybeSingle();
        if (data?.monime_space_id) await db.from('org_secrets').update({ monime_space_id: null, monime_token_enc: null }).eq('org_id', orgId);
        else {
          // Easy payments: first send whatever is left in the box to the owner. The box is kept (empty) for reconnecting.
          await sweepToOwner(orgId, `off-${Date.now()}`).catch((e) => console.error(e));
          await db.from('org_secrets').update({ easy_on: false }).eq('org_id', orgId);
        }
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
        const c = await credsFor(orgId);
        const session = await monime<{ id: string; redirectUrl: string }>(c, 'POST', '/checkout-sessions', {
          name: `${org!.name} · ${inv.number}`.slice(0, 150), lineItems, reference: inv.number, ...settleTo(c),
          ...(appUrl ? { successUrl: `${appUrl}#/i/${inv.public_token}`, cancelUrl: `${appUrl}#/i/${inv.public_token}` } : {}),
          brandingOptions: { primaryColor: '#047857' }, metadata: { orgId, invoiceId: inv.id, requestId },
        }, `checkout-${inv.id}-${Math.floor(Date.now() / 600000)}`);
        await db.from('payment_requests').insert({
          id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'checkout', invoice_id: inv.id, amount: total,
          status: 'pending', provider_ref: session.id, url: session.redirectUrl, note: inv.number,
        });
        return json({ url: session.redirectUrl, requestId });
      }
      case 'link': {
        const amount = Math.round(Number(body.amount));
        if (!(amount > 0) || amount > 1_000_000_000) throw new HttpError(400, 'Invalid amount');
        const { data: org } = await db.from('orgs').select('name').eq('id', orgId).single();
        const name = String(body.name ?? '').trim().slice(0, 100) || org!.name;
        const requestId = crypto.randomUUID();
        const appUrl = Deno.env.get('PUBLIC_APP_URL');
        const c = await credsFor(orgId);
        const session = await monime<{ id: string; redirectUrl: string }>(c, 'POST', '/checkout-sessions', {
          name: `${org!.name} · ${name}`.slice(0, 150), lineItems: [{ type: 'custom', name, price: SLE(amount), quantity: 1 }], reference: requestId.slice(0, 64), ...settleTo(c),
          ...(appUrl ? { successUrl: appUrl, cancelUrl: appUrl } : {}), brandingOptions: { primaryColor: '#047857' }, metadata: { orgId, requestId },
        }, `link-${requestId}`);
        await db.from('payment_requests').insert({
          id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'checkout', amount, status: 'pending',
          provider_ref: session.id, url: session.redirectUrl, note: name,
        });
        return json({ url: session.redirectUrl, requestId });
      }
      case 'ussd': {
        const amount = Math.round(Number(body.amount));
        if (!(amount > 0)) throw new HttpError(400, 'Invalid amount');
        const requestId = crypto.randomUUID();
        const name = String(body.name ?? 'Kopor payment').padEnd(3, ' ').slice(0, 64);
        // An invoice or group named here must belong to this business (the webhook marks it paid later).
        if (body.invoiceId && !(await db.from('invoices').select('id').eq('id', String(body.invoiceId)).eq('org_id', orgId).maybeSingle()).data) throw new HttpError(400, 'Invoice not found');
        if (body.groupId && !(await db.from('groups').select('id').eq('id', String(body.groupId)).eq('org_id', orgId).maybeSingle()).data) throw new HttpError(400, 'Group not found');
        const c = await credsFor(orgId);
        const payer = body.phone ? normalizeSlPhone(String(body.phone)) : null;
        const code = await monime<{ id: string; ussdCode: string }>(c, 'POST', '/payment-codes', {
          name, mode: 'one_time', amount: SLE(amount), duration: '24h', reference: requestId.slice(0, 64), ...settleTo(c),
          // When the customer's number is known, only that phone can pay this code.
          ...(payer ? { authorizedPhoneNumber: payer } : {}),
          metadata: { orgId, requestId, ...(body.invoiceId ? { invoiceId: String(body.invoiceId) } : {}), ...(body.groupId ? { groupId: String(body.groupId) } : {}) },
        }, `ussd-${requestId}`);
        await db.from('payment_requests').insert({
          id: requestId, org_id: orgId, created_at: nowMs(), updated_at: nowMs(), kind: 'ussd', invoice_id: body.invoiceId ?? null, group_id: body.groupId ?? null,
          amount, status: 'pending', provider_ref: code.id, ussd_code: code.ussdCode, phone: body.phone ?? null, note: name,
        });
        return json({ ussdCode: code.ussdCode, requestId });
      }
      case 'wallet': {
        // The money is in the business's own Monime account (Monime is licensed by the Bank of Sierra Leone).
        const c = await credsFor(orgId);
        const items = c.fac
          ? [await monime<MonimeAccount>(c, 'GET', `/financial-accounts/${encodeURIComponent(c.fac)}?withBalance=true`)]
          : (await monimeList<MonimeAccount>(c, '/financial-accounts?withBalance=true&limit=50')).items;
        const accounts = items.map((a) => ({ id: a.id, name: a.name, currency: a.currency, uvan: a.uvan ?? '', balance: a.balance?.available?.value ?? 0 }));
        return json({ accounts, total: accounts.filter((a) => a.currency === 'SLE').reduce((s, a) => s + a.balance, 0), at: new Date().toISOString() });
      }
      case 'history': {
        const c = await credsFor(orgId);
        const q = new URLSearchParams({ limit: '30' });
        // Easy payments: only ever this business's own box (Kopor's account holds other businesses' boxes too).
        if (c.fac) q.set('financialAccountId', c.fac);
        else if (/^fac-/.test(String(body.accountId ?? ''))) q.set('financialAccountId', String(body.accountId));
        if (typeof body.after === 'string' && body.after.length <= 2000) q.set('after', body.after);
        const { items, next } = await monimeList<MonimeTxn>(c, `/financial-transactions?${q}`);
        return json({
          next,
          items: items.map((t) => ({
            id: t.id, type: t.type, amount: Math.abs(t.amount?.value ?? 0), currency: t.amount?.currency ?? 'SLE', time: t.timestamp,
            reference: t.reference ?? '', balanceAfter: t.financialAccount?.balance?.after?.value ?? null,
            // What caused it, in words the app can translate: payment_code, checkout_session, payout, internal_transfer, fee, reversal.
            kind: t.originatingFee ? 'fee' : t.originatingReversal ? 'reversal' : t.ownershipGraph?.owner?.type ?? 'other',
            note: t.metadata?.note ?? t.ownershipGraph?.owner?.metadata?.name ?? '',
          })),
        });
      }
      case 'payout': {
        const amount = Math.round(Number(body.amount));
        const phone = normalizeSlPhone(String(body.phone ?? '')) ?? String(body.phone ?? '').replace(/[^\d+]/g, '');
        if (!(amount > 0) || phone.length < 8 || !/^m\d+$/.test(String(body.providerId))) throw new HttpError(400, 'Invalid payout');
        const requestId = crypto.randomUUID();
        const c = await credsFor(orgId);
        const p = await monime<{ id: string; status: string }>(c, 'POST', '/payouts', {
          amount: SLE(amount), ...(c.fac ? { source: { financialAccountId: c.fac } } : {}), destination: { type: 'momo', providerId: body.providerId, phoneNumber: phone },
          metadata: { orgId, requestId, note: String(body.note ?? '').slice(0, 100), ...(body.groupId ? { groupId: String(body.groupId) } : {}) },
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
