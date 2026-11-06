// Mobile money reversals (migration 0040). Monime sends no message when a payment is pulled back, so every 10
// minutes the server reads each connected business's recent Monime records, finds new reversals, follows each one
// back to the Kopor payment link, code or invoice it undoes, puts the records right and alerts the owner.
import { admin, nowMs } from './util.ts';
import { credsFor, monime, monimeList, type MonimeCreds } from './monime.ts';
import { recentReversals, type MonimeTxn } from './reversalPick.ts';

/** The Monime object (payment link session or payment code) the original payment came from. */
async function originOf(c: MonimeCreds, originTxnId: string, page: MonimeTxn[]): Promise<string | null> {
  const local = page.find((t) => t.id === originTxnId);
  const t = local ?? await monime<MonimeTxn>(c, 'GET', `/financial-transactions/${encodeURIComponent(originTxnId)}`).catch(() => null);
  return t?.ownershipGraph?.owner?.id ?? null;
}

const today = () => new Date().toISOString().slice(0, 10);

async function handle(orgId: string, c: MonimeCreds, rev: MonimeTxn, page: MonimeTxn[]) {
  const db = admin();
  const origin = rev.originatingReversal!.originTxnId;
  const amount = Math.abs(rev.amount?.value ?? 0);
  // Claim it first, so two runs never handle the same reversal twice.
  const { error: taken } = await db.from('monime_reversals').insert({ txn_id: rev.id, org_id: orgId, origin_txn_id: origin, amount });
  if (taken) return false;
  try {
    return await apply(orgId, c, rev, page, origin, amount);
  } catch (e) {
    await db.from('monime_reversals').delete().eq('txn_id', rev.id); // try again on the next run
    throw e;
  }
}

async function apply(orgId: string, c: MonimeCreds, rev: MonimeTxn, page: MonimeTxn[], origin: string, amount: number) {
  const db = admin();
  const source = await originOf(c, origin, page);
  const { data: pr } = source
    ? await db.from('payment_requests').select('*').eq('org_id', orgId).eq('provider_ref', source).neq('kind', 'payout').maybeSingle()
    : { data: null };
  const now = nowMs();
  let detail = 'outside', who = '';

  if (pr && pr.status !== 'reversed') {
    await db.from('payment_requests').update({ status: 'reversed', updated_at: now }).eq('id', pr.id);
    await db.from('monime_reversals').update({ request_id: pr.id }).eq('txn_id', rev.id);
    if (pr.invoice_id) {
      // The invoice is unpaid again and the customer owes the money again.
      const { data: inv } = await db.from('invoices').select('*').eq('id', pr.invoice_id).eq('org_id', orgId).maybeSingle();
      if (inv) {
        detail = inv.number; who = inv.customer ?? '';
        if (inv.status === 'paid') await db.from('invoices').update({ status: 'unpaid', paid_date: null, updated_at: now }).eq('id', inv.id).eq('org_id', orgId);
        if (inv.contact_id) {
          await db.from('ledger').insert({
            id: crypto.randomUUID(), org_id: orgId, created_at: now, updated_at: now, created_by: null, branch_id: inv.branch_id,
            contact_id: inv.contact_id, type: 'gave', amount: amount || pr.amount, note: `${inv.number}: payment reversed by the customer`,
            date: today(), ref_type: 'invoice', ref_id: inv.id,
          });
        }
      }
    } else if (!pr.group_id) {
      // A payment link or code went into the cash book as money received: take it out again.
      detail = pr.note || (pr.kind === 'ussd' ? 'USSD' : 'link');
      await db.from('transactions').insert({
        id: crypto.randomUUID(), org_id: orgId, created_at: now, updated_at: now, created_by: null, branch_id: null, type: 'out', category: 'reversal',
        amount: amount || pr.amount, method: 'bank', contact_id: null, note: `Payment reversed${pr.note ? `: ${pr.note}` : ''}`, date: today(),
        items: [], ledger_id: null, invoice_id: null, discount: 0, tax: 0, refund_of: null,
      });
    } else detail = 'group';
    await db.from('audit').insert({
      id: crypto.randomUUID(), org_id: orgId, created_at: now, updated_at: now, member_name: 'Monime', action: 'update', entity: 'payment_requests',
      entity_id: pr.id, summary: `Payment of ${(amount || pr.amount) / 100} reversed`, at: now,
    });
  }
  await db.rpc('kopor_alert', { o: orgId, k: 'reversal', r: rev.id, w: who, a: amount || pr?.amount || 0, d: detail });
  return true;
}

/** Look at every connected business (at most once every 5 minutes, however often it is asked). */
export async function scanReversals() {
  const db = admin();
  const { error: busy } = await db.from('job_claims').insert({ name: 'reversals', slot: Math.floor(Date.now() / 300_000) });
  if (busy) return { skipped: 'ran in the last 5 minutes' };
  const { data: orgs } = await db.from('org_secrets').select('org_id, monime_space_id, easy_on, easy_fac_id');
  let checked = 0, found = 0, failed = 0;
  for (const o of orgs ?? []) {
    if (!o.monime_space_id && !(o.easy_on && o.easy_fac_id)) continue;
    try {
      const c = await credsFor(o.org_id);
      const q = new URLSearchParams({ limit: '50' });
      if (c.fac) q.set('financialAccountId', c.fac); // easy payments: only this business's own box
      const { items } = await monimeList<MonimeTxn>(c, `/financial-transactions?${q}`);
      checked++;
      for (const r of recentReversals(items)) if (await handle(o.org_id, c, r, items)) found++;
    } catch (e) { failed++; console.error('reversals', o.org_id, e); }
  }
  return { checked, found, failed };
}
