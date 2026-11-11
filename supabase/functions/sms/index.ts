// Text messages from the shop's own phone (SMS Gateway for Android). Actions:
//   { action: 'status', orgId }                                   -> connected, settings, sent today (managers+)
//   { action: 'connect', orgId, user, pass, signingKey }          -> check the login, register the BAL webhook (owner)
//   { action: 'settings', orgId, auto?, bal?, limit?, receipts? } -> automatic reminders / BAL replies / receipts (owner)
//   { action: 'disconnect', orgId }                               (owner)
//   { action: 'test', orgId }                                     -> a test text to the business's own phone (owner)
//   { action: 'remind', orgId, contactId }                        -> text one customer what they owe now (managers+)
//   { action: 'broadcast', orgId, contactIds, text }              -> one message to chosen customers, {name} filled in
//                                                                    (managers+; within the daily text limit)
//   { action: 'receipts' }                                        -> every few minutes: a text to customers who just paid
//                                                                    (shops that switched receipts on)
//   { action: 'run' }                                             -> daily: automatic reminders for every business that
//                                                                    turned them on (at most once a day, like push)
import { admin, caller, cors, env, HttpError, json, randomSecret, requireLevel, seal } from '../_shared/util.ts';
import { gate, gateFor, leones, sendText, sentToday } from '../_shared/smsgate.ts';
import { normalizeSlPhone } from '../_shared/momo.ts';

const LEVEL: Record<string, number> = { status: 2, connect: 3, settings: 3, disconnect: 3, test: 3, remind: 2, broadcast: 2 };
const WEEK = 7 * 86_400_000;
type Entry = { contact_id: string; type: 'gave' | 'got'; amount: number; date: string; due_date: string | null; created_at: number };

/** Same rule as the app: payments go to the oldest credit first; a credit still unpaid after its due date is overdue. */
function overdue(rows: Entry[], today: string): string | null {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at);
  let paid = sorted.filter((e) => e.type === 'got').reduce((s, e) => s + e.amount, 0);
  for (const e of sorted) {
    if (e.type !== 'gave') continue;
    const covered = Math.min(paid, e.amount);
    paid -= covered;
    if (covered < e.amount && e.due_date && e.due_date < today) return e.due_date;
  }
  return null;
}

async function owing(orgId: string, contactId?: string) {
  const db = admin();
  let q = db.from('ledger').select('contact_id, type, amount, date, due_date, created_at').eq('org_id', orgId).eq('deleted', 0);
  if (contactId) q = q.eq('contact_id', contactId);
  const { data } = await q.limit(20000);
  const by = new Map<string, Entry[]>();
  for (const e of (data ?? []) as Entry[]) by.set(e.contact_id, [...(by.get(e.contact_id) ?? []), e]);
  return by;
}

const reminderText = (business: string, name: string, amount: number, bal: boolean) =>
  `${business}: Hello ${name.split(' ')[0]}, you owe ${leones(amount)}. Please pay when you can. Thank you.${bal ? ' Text BAL to this number to check your balance.' : ''}`;

/** Automatic reminders for one business: overdue customers with a phone, not texted in the last week, up to its limit. */
async function remindAll(orgId: string): Promise<number> {
  const db = admin();
  const g = await gateFor(orgId);
  if (!g?.auto) return 0;
  let left = g.limit - (await sentToday(orgId));
  if (left <= 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: org }, { data: people }, { data: recent }] = await Promise.all([
    db.from('orgs').select('name').eq('id', orgId).single(),
    db.from('contacts').select('id, name, phone').eq('org_id', orgId).eq('deleted', 0).eq('kind', 'customer').neq('phone', ''),
    db.from('sms_log').select('contact_id').eq('org_id', orgId).eq('kind', 'reminder').gte('at', new Date(Date.now() - WEEK).toISOString()),
  ]);
  const texted = new Set((recent ?? []).map((r) => r.contact_id));
  const ledger = await owing(orgId);
  let sent = 0;
  for (const c of people ?? []) {
    if (left <= 0) break;
    if (texted.has(c.id)) continue;
    const rows = ledger.get(c.id) ?? [];
    const bal = rows.reduce((s, e) => s + (e.type === 'gave' ? e.amount : -e.amount), 0);
    const to = normalizeSlPhone(c.phone);
    if (bal <= 0 || !to || !overdue(rows, today)) continue;
    let ok = true;
    try { await sendText(g, to, reminderText(org!.name, c.name, bal, g.bal)); sent++; left--; } catch (e) { ok = false; console.error('sms remind', orgId, e); }
    await db.from('sms_log').insert({ org_id: orgId, contact_id: c.id, kind: 'reminder', ok });
    if (!ok) break; // the phone is offline: try again tomorrow
  }
  // A friendly word the day before a payment is due (an instalment or any dated credit), before it is late.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const { data: soonLog } = await db.from('sms_log').select('contact_id').eq('org_id', orgId).eq('kind', 'dueSoon').gte('at', new Date(Date.now() - 2 * 86_400_000).toISOString());
  const told = new Set((soonLog ?? []).map((r) => r.contact_id));
  for (const c of people ?? []) {
    if (left <= 0) break;
    if (told.has(c.id) || texted.has(c.id)) continue;
    const rows = ledger.get(c.id) ?? [];
    const due = dueOn(rows, tomorrow);
    const to = normalizeSlPhone(c.phone);
    if (!due || !to || overdue(rows, today)) continue;
    let ok = true;
    try {
      await sendText(g, to, `${org!.name}: Hello ${c.name.split(' ')[0]}, ${leones(due)} is due tomorrow. Thank you.${g.bal ? ' Text BAL to check your balance.' : ''}`);
      sent++; left--;
    } catch (e) { ok = false; console.error('sms due soon', orgId, e); }
    await db.from('sms_log').insert({ org_id: orgId, contact_id: c.id, kind: 'dueSoon', ok });
    if (!ok) break;
  }
  return sent;
}

/** What is still unpaid on credits due on this day (payments clear the oldest credit first). */
function dueOn(rows: Entry[], day: string): number {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at);
  let paid = sorted.filter((e) => e.type === 'got').reduce((s, e) => s + e.amount, 0), sum = 0;
  for (const e of sorted) {
    if (e.type !== 'gave') continue;
    const covered = Math.min(paid, e.amount);
    paid -= covered;
    if (covered < e.amount && e.due_date === day) sum += e.amount - covered;
  }
  return sum;
}

/** Payment receipts: customers who just paid a debt get a text with what was received and what is left. */
async function receiptsFor(orgId: string): Promise<number> {
  const db = admin();
  const g = await gateFor(orgId);
  if (!g) return 0;
  let left = g.limit - (await sentToday(orgId));
  if (left <= 0) return 0;
  const since = Date.now() - 6 * 3_600_000; // payments recorded in the last 6 hours (phones may sync late)
  const { data: paid } = await db.from('ledger').select('id, contact_id, amount, created_at').eq('org_id', orgId).eq('deleted', 0).eq('type', 'got').gt('created_at', since).limit(200);
  if (!paid?.length) return 0;
  const { data: done } = await db.from('sms_receipted').select('ledger_id').in('ledger_id', paid.map((p) => p.id));
  const skip = new Set((done ?? []).map((d) => d.ledger_id));
  const todo = paid.filter((p) => !skip.has(p.id));
  if (!todo.length) return 0;
  const [{ data: org }, { data: people }] = await Promise.all([
    db.from('orgs').select('name').eq('id', orgId).single(),
    db.from('contacts').select('id, name, phone, kind').in('id', [...new Set(todo.map((p) => p.contact_id))]),
  ]);
  let sent = 0;
  for (const p of todo) {
    if (left <= 0) break;
    const c = (people ?? []).find((x) => x.id === p.contact_id);
    const to = c && c.kind !== 'supplier' ? normalizeSlPhone(c.phone) : null;
    // Claim it first, so a payment is never texted twice.
    const { error: taken } = await db.from('sms_receipted').insert({ ledger_id: p.id, org_id: orgId });
    if (taken || !to || !c) continue;
    const rows = (await owing(orgId, c.id)).get(c.id) ?? [];
    const bal = rows.reduce((s, e) => s + (e.type === 'gave' ? e.amount : -e.amount), 0);
    let ok = true;
    try {
      await sendText(g, to, `${org!.name}: received ${leones(p.amount)} from ${c.name.split(' ')[0]}. ${bal > 0 ? `You now owe ${leones(bal)}.` : 'You owe nothing now.'} Thank you!`);
      sent++; left--;
    } catch (e) { ok = false; console.error('sms receipt', orgId, e); await db.from('sms_receipted').delete().eq('ledger_id', p.id); }
    await db.from('sms_log').insert({ org_id: orgId, contact_id: c.id, kind: 'receipt', ok });
    if (!ok) break;
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const db = admin();
    if (body.action === 'receipts') {
      const { error: busy } = await db.from('job_claims').insert({ name: 'receipts', slot: Math.floor(Date.now() / 120_000) });
      if (busy) return json({ skipped: 'ran in the last 2 minutes' });
      await db.from('job_claims').delete().eq('name', 'receipts').lt('slot', Math.floor(Date.now() / 120_000) - 720);
      const { data: orgs } = await db.from('org_secrets').select('org_id').eq('sms_receipts', true).not('sms_user', 'is', null);
      let sent = 0;
      for (const o of orgs ?? []) sent += await receiptsFor(o.org_id).catch((e) => { console.error('receipts', o.org_id, e); return 0; });
      return json({ sent, businesses: (orgs ?? []).length });
    }
    if (body.action === 'run') {
      const day = new Date().toISOString().slice(0, 10);
      const { error: claimed } = await db.from('sms_runs').insert({ day });
      if (claimed) return json({ skipped: 'already ran today' });
      // Once a day also delete what Kopor no longer needs to keep (see migration 0029).
      const { data: cleaned, error: cleanErr } = await db.rpc('kopor_cleanup');
      if (cleanErr) console.error('cleanup', cleanErr.message); else console.log('cleanup', JSON.stringify(cleaned));
      const { data: orgs } = await db.from('org_secrets').select('org_id').eq('sms_auto', true).not('sms_user', 'is', null);
      let sent = 0;
      for (const o of orgs ?? []) sent += await remindAll(o.org_id).catch((e) => { console.error('sms run', o.org_id, e); return 0; });
      await db.from('sms_runs').update({ sent }).eq('day', day);
      return json({ sent, businesses: (orgs ?? []).length });
    }
    const orgId = String(body.orgId ?? '');
    if (!(body.action in LEVEL) || !/^[0-9a-f-]{36}$/.test(orgId)) throw new HttpError(400, 'Bad request');
    const { level } = await caller(req, orgId);
    requireLevel(level, LEVEL[body.action]);

    switch (body.action) {
      case 'status': {
        const g = await gateFor(orgId);
        const { data: rc } = await db.from('org_secrets').select('sms_receipts').eq('org_id', orgId).maybeSingle();
        return json({ connected: !!g, auto: g?.auto ?? false, bal: g?.bal ?? true, receipts: !!rc?.sms_receipts, limit: g?.limit ?? 20, signed: !!g?.sign, sentToday: g ? await sentToday(orgId) : 0 });
      }
      case 'connect': {
        const user = String(body.user ?? '').trim(), pass = String(body.pass ?? '').trim(), sign = String(body.signingKey ?? '').trim();
        if (!user || !pass) throw new HttpError(400, 'Enter the username and password from SMS Gateway → Cloud server');
        await gate({ user, pass }, 'GET', '/webhooks');                    // checks the login
        const token = randomSecret(32);
        const url = `${env('SUPABASE_URL')}/functions/v1/sms-webhook?org=${orgId}&k=${token}`;
        await gate({ user, pass }, 'POST', '/webhooks', { url, event: 'sms:received' });
        const { error } = await db.from('org_secrets').upsert({
          org_id: orgId, sms_user: user, sms_pass_enc: await seal(pass), sms_sign_enc: sign ? await seal(sign) : null, sms_hook_token: token,
          updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case 'settings': {
        const patch: Record<string, unknown> = {};
        if (typeof body.auto === 'boolean') patch.sms_auto = body.auto;
        if (typeof body.receipts === 'boolean') patch.sms_receipts = body.receipts;
        if (typeof body.bal === 'boolean') patch.sms_bal = body.bal;
        if (Number.isInteger(body.limit) && body.limit >= 1 && body.limit <= 200) patch.sms_daily_limit = body.limit;
        if (typeof body.signingKey === 'string' && body.signingKey.trim()) patch.sms_sign_enc = await seal(body.signingKey.trim());
        const { error } = await db.from('org_secrets').update(patch).eq('org_id', orgId);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case 'disconnect': {
        await db.from('org_secrets').update({ sms_user: null, sms_pass_enc: null, sms_sign_enc: null, sms_hook_token: null, sms_auto: false }).eq('org_id', orgId);
        return json({ ok: true });
      }
      case 'test': {
        const g = await gateFor(orgId);
        if (!g) throw new HttpError(400, 'Connect the phone first');
        const { data: org } = await db.from('orgs').select('name, phone').eq('id', orgId).single();
        const to = normalizeSlPhone(org?.phone ?? '');
        if (!to) throw new HttpError(400, 'Add the business phone number in Settings first');
        await sendText(g, to, `${org!.name}: Kopor text messages are working.`);
        await db.from('sms_log').insert({ org_id: orgId, kind: 'test' });
        return json({ ok: true, to });
      }
      case 'remind': {
        const g = await gateFor(orgId);
        if (!g) throw new HttpError(400, 'Connect the phone first');
        if ((await sentToday(orgId)) >= g.limit) throw new HttpError(429, 'Today’s text limit is reached. Raise it in Settings or try tomorrow.');
        const { data: c } = await db.from('contacts').select('id, name, phone').eq('id', String(body.contactId)).eq('org_id', orgId).eq('deleted', 0).maybeSingle();
        const to = c && normalizeSlPhone(c.phone);
        if (!c || !to) throw new HttpError(400, 'This customer has no Sierra Leone phone number');
        const rows = (await owing(orgId, c.id)).get(c.id) ?? [];
        const bal = rows.reduce((s, e) => s + (e.type === 'gave' ? e.amount : -e.amount), 0);
        if (bal <= 0) throw new HttpError(400, 'This customer owes nothing');
        const { data: org } = await db.from('orgs').select('name').eq('id', orgId).single();
        await sendText(g, to, reminderText(org!.name, c.name, bal, g.bal));
        await db.from('sms_log').insert({ org_id: orgId, contact_id: c.id, kind: 'reminder' });
        return json({ ok: true });
      }
      // Messages to customers (new stock, offers, opening hours), sent from the shop's own phone. The shop's name is
      // added so customers know who wrote; numbers are taken from the business's own customers only.
      case 'broadcast': {
        const g = await gateFor(orgId);
        if (!g) throw new HttpError(400, 'Connect the phone first');
        const text = String(body.text ?? '').trim();
        const ids = Array.isArray(body.contactIds) ? body.contactIds.map(String).filter((x: string) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500) : [];
        if (text.length < 5 || text.length > 300 || !ids.length) throw new HttpError(400, 'Bad request');
        const { data: org } = await db.from('orgs').select('name').eq('id', orgId).single();
        const { data: people } = await db.from('contacts').select('id, name, phone').eq('org_id', orgId).eq('deleted', 0).in('id', ids);
        let left = g.limit - (await sentToday(orgId)), sent = 0, skipped = 0;
        const seen = new Set<string>();
        for (const c of people ?? []) {
          const to = normalizeSlPhone(c.phone);
          if (!to || seen.has(to)) { skipped++; continue; }
          if (left-- <= 0) break;
          seen.add(to);
          await sendText(g, to, `${org!.name}: ${text.replaceAll('{name}', String(c.name).split(' ')[0])}`);
          await db.from('sms_log').insert({ org_id: orgId, contact_id: c.id, kind: 'broadcast' });
          sent++;
        }
        return json({ sent, skipped, notSent: Math.max(0, (people ?? []).length - sent - skipped) });
      }
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
