// Texts that arrive on the shop's phone (SMS Gateway for Android webhook, event sms:received). A customer who texts
// BAL gets their balance back. Deploy with --no-verify-jwt (the phone has no Supabase login).
// Security: the address carries a per-business secret, the body must carry the app's HMAC-SHA256 signature
// (X-Signature over body + X-Timestamp), and old messages (more than 5 minutes) are refused.
import { admin, json } from '../_shared/util.ts';
import { gateFor, leones, sameHex, sendText, sentToday, signature } from '../_shared/smsgate.ts';
import { normalizeSlPhone } from '../_shared/momo.ts';

const ASK = /^\s*(bal|balance|my balance|how much|ɔw|ow|solde)\s*\??\s*$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const url = new URL(req.url);
    const orgId = url.searchParams.get('org') ?? '', key = url.searchParams.get('k') ?? '';
    if (!/^[0-9a-f-]{36}$/.test(orgId) || key.length < 20) return json({ error: 'Unauthorized' }, 401);
    const g = await gateFor(orgId);
    if (!g || !g.token || !sameHex(g.token, key)) return json({ error: 'Unauthorized' }, 401);
    const raw = await req.text();
    const ts = req.headers.get('x-timestamp') ?? '';
    if (!g.sign) return json({ error: 'Signing key not set' }, 401);
    if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return json({ error: 'Too old' }, 401);
    if (!sameHex((req.headers.get('x-signature') ?? '').toLowerCase(), await signature(g.sign, raw, ts))) return json({ error: 'Bad signature' }, 401);

    const evt = JSON.parse(raw);
    if (evt?.event !== 'sms:received') return json({ ignored: true });
    const text = String(evt.payload?.message ?? ''), from = normalizeSlPhone(String(evt.payload?.sender ?? ''));
    if (!g.bal || !from || !ASK.test(text)) return json({ ignored: true });
    if ((await sentToday(orgId)) >= g.limit) return json({ ignored: 'daily limit' });

    const db = admin();
    const [{ data: org }, { data: people }] = await Promise.all([
      db.from('orgs').select('name, phone').eq('id', orgId).single(),
      db.from('contacts').select('id, name, phone').eq('org_id', orgId).eq('deleted', 0).neq('phone', ''),
    ]);
    const c = (people ?? []).find((p) => normalizeSlPhone(p.phone) === from);
    let reply: string;
    if (!c) reply = `${org!.name}: we could not find your account with this number.${org?.phone ? ` Please call ${org.phone}.` : ''}`;
    else {
      const { data: rows } = await db.from('ledger').select('type, amount').eq('org_id', orgId).eq('contact_id', c.id).eq('deleted', 0);
      const bal = (rows ?? []).reduce((s, e) => s + (e.type === 'gave' ? e.amount : -e.amount), 0);
      reply = bal > 0 ? `${org!.name}: ${c.name.split(' ')[0]}, you owe ${leones(bal)}. Thank you.`
        : bal < 0 ? `${org!.name}: ${c.name.split(' ')[0]}, we owe you ${leones(-bal)}.`
        : `${org!.name}: ${c.name.split(' ')[0]}, you owe nothing. Thank you!`;
    }
    await sendText(g, from, reply);
    await db.from('sms_log').insert({ org_id: orgId, contact_id: c?.id ?? null, kind: 'balance' });
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
});
