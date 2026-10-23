// Receives Monime events. Deploy with --no-verify-jwt (Monime has no Supabase token).
// Security: (1) a per-business secret header set when the webhook was registered, and
// (2) the status is re-fetched from Monime's API, so a forged body can never mark anything paid.
import { admin, json, nowMs, today } from '../_shared/util.ts';
import { credsFor, monime, platformCreds, sweepToOwner, type MonimeCreds } from '../_shared/monime.ts';

const PATH: Record<string, string> = { payment_code: '/payment-codes/', checkout_session: '/checkout-sessions/', payout: '/payouts/' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const evt = await req.json();
    const type = String(evt?.object?.type ?? evt?.event?.name?.split('.')[0] ?? '');
    const objectId = String(evt?.object?.id ?? evt?.data?.id ?? '');
    const meta = (evt?.data?.metadata ?? {}) as Record<string, string>;
    const orgId = meta.orgId, requestId = meta.requestId;
    if (!PATH[type] || !objectId || !orgId || !requestId) return json({ ignored: true });

    const db = admin();
    const subscription = meta.kind === 'subscription';
    // Kopor Pro payments and easy payments arrive on Kopor's own Monime account; other business payments on the business's account.
    const creds: MonimeCreds = subscription ? platformCreds() : await credsFor(orgId);
    const easy = !subscription && !!creds.fac;
    const expected = subscription || easy ? Deno.env.get('KOPOR_WEBHOOK_SECRET')
      : (await db.from('org_secrets').select('webhook_secret').eq('org_id', orgId).maybeSingle()).data?.webhook_secret;
    if (!expected || req.headers.get('x-kopor-secret') !== expected) return json({ error: 'Unauthorized' }, 401);

    // Trust Monime's API, not the webhook body.
    const fresh = await monime<{ status: string }>(creds, 'GET', PATH[type] + encodeURIComponent(objectId));
    const status = ['pending', 'processing', 'completed', 'failed', 'expired', 'cancelled'].includes(fresh.status) ? fresh.status : 'pending';

    const { data: pr } = await db.from('payment_requests').select('*').eq('id', requestId).eq('org_id', orgId).maybeSingle();
    if (!pr || pr.provider_ref !== objectId) return json({ ignored: true });
    if (pr.status === status) return json({ ok: true, unchanged: true });
    await db.from('payment_requests').update({ status, updated_at: nowMs() }).eq('id', pr.id);

    // Kopor Pro paid: extend the plan from today or from the current expiry, whichever is later.
    if (subscription && status === 'completed') {
      const months = Number(meta.months) === 12 ? 12 : 1;
      const { data: org } = await db.from('orgs').select('plan_until').eq('id', orgId).single();
      const from = Math.max(nowMs(), Number(org?.plan_until ?? 0));
      await db.from('orgs').update({ plan: 'pro', plan_until: from + months * 30 * 86_400_000, updated_at: nowMs() }).eq('id', orgId);
      return json({ ok: true, upgraded: true });
    }

    // A completed customer payment marks the invoice paid and records it in the credit book.
    if (status === 'completed' && pr.kind !== 'payout' && pr.invoice_id) {
      const { data: inv } = await db.from('invoices').select('*').eq('id', pr.invoice_id).maybeSingle();
      if (inv && inv.status === 'unpaid') {
        const now = nowMs();
        await db.from('invoices').update({ status: 'paid', paid_date: today(), updated_at: now }).eq('id', inv.id);
        if (inv.contact_id) {
          await db.from('ledger').insert({
            id: crypto.randomUUID(), org_id: orgId, created_at: now, updated_at: now, created_by: null, branch_id: inv.branch_id,
            contact_id: inv.contact_id, type: 'got', amount: pr.amount, note: `${inv.number} paid via Monime`, date: today(), ref_type: 'invoice', ref_id: inv.id,
            verified_ref: String(pr.provider_ref ?? pr.id), // only the server can set this: the app shows "Confirmed by Monime"
          });
        }
        await db.from('audit').insert({
          id: crypto.randomUUID(), org_id: orgId, created_at: now, updated_at: now, member_name: 'Monime', action: 'update', entity: 'invoices',
          entity_id: inv.id, summary: `${inv.number} paid online`, at: now,
        });
      }
    }
    // A standalone payment link or USSD code (Money → Receive) goes into the cash book as money received.
    if (status === 'completed' && pr.kind !== 'payout' && !pr.invoice_id && !pr.group_id) {
      const now = nowMs();
      await db.from('transactions').insert({
        id: crypto.randomUUID(), org_id: orgId, created_at: now, updated_at: now, created_by: null, branch_id: null, type: 'in', category: 'sale',
        amount: pr.amount, method: 'bank', contact_id: null, note: `${pr.note ?? ''} · Monime ${pr.kind === 'ussd' ? 'USSD' : 'link'}`.trim(), date: today(),
        items: [], ledger_id: null, invoice_id: null, discount: 0, tax: 0, refund_of: null,
        verified_ref: String(pr.provider_ref ?? pr.id), // only the server can set this: the app shows "Confirmed by Monime"
      });
      await db.from('audit').insert({
        id: crypto.randomUUID(), org_id: orgId, created_at: now, updated_at: now, member_name: 'Monime', action: 'create', entity: 'transactions',
        entity_id: pr.id, summary: `Received ${pr.amount / 100} online`, at: now,
      });
    }
    // Easy payments: send the money straight on to the owner's mobile money number (unless they turned that off).
    if (easy && status === 'completed' && pr.kind !== 'payout') {
      const { data: s } = await db.from('org_secrets').select('easy_auto').eq('org_id', orgId).maybeSingle();
      if (s?.easy_auto !== false) await sweepToOwner(orgId, pr.id).catch((e) => console.error('sweep', e));
    }
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
});
