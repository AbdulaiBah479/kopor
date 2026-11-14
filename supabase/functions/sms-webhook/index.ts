// Texts that arrive on the shop's phone (SMS Gateway for Android webhook, event sms:received). A customer who texts
// BAL gets their balance back; STMT gets their last 5 entries and the balance (a mini-statement).
// Owners and managers can text TODAY, OWE or STOCK <item> with their 6-digit PIN (for example "TODAY 123456") and get
// the business's figures from anywhere, on any phone. The reply always goes to the number that is on their account. Deploy with --no-verify-jwt (the phone has no Supabase login).
// Security: the address carries a per-business secret, the body must carry the app's HMAC-SHA256 signature
// (X-Signature over body + X-Timestamp), and old messages (more than 5 minutes) are refused.
import { admin, json } from '../_shared/util.ts';
import { gateFor, leones, sameHex, sendText, sentToday, signature } from '../_shared/smsgate.ts';
import { normalizeSlPhone } from '../_shared/momo.ts';
import { checkPhonePin } from '../_shared/pinCheck.ts';

const ASK = /^\s*(bal|balance|my balance|how much|ɔw|ow|solde)\s*\??\s*$/i;
const CMD = /^\s*(today|owe|stock)\s+(\d{6})(?:\s+(.{1,40}?))?\s*$/i;
const STMT = /^\s*(stmt|statement|mini statement|history|stetmɛnt|relevé|releve)\s*\??\s*$/i;

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
    // Owner commands (any phone): the figures go back only to a registered owner or manager who gave the right PIN.
    const cmd = text.match(CMD);
    if (cmd && from) {
      if ((await sentToday(orgId)) >= g.limit) return json({ ignored: 'daily limit' });
      const reply = await ownerCommand(orgId, from, cmd[1].toLowerCase(), cmd[2], (cmd[3] ?? '').trim());
      await sendText(g, from, reply);
      await admin().from('sms_log').insert({ org_id: orgId, contact_id: null, kind: 'command' });
      return json({ ok: true });
    }
    const wantsStatement = STMT.test(text);
    if (!g.bal || !from || !(ASK.test(text) || wantsStatement)) return json({ ignored: true });
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
      const { data: rows } = await db.from('ledger').select('type, amount, date, created_at').eq('org_id', orgId).eq('contact_id', c.id).eq('deleted', 0);
      const bal = (rows ?? []).reduce((s, e) => s + (e.type === 'gave' ? e.amount : -e.amount), 0);
      reply = bal > 0 ? `${org!.name}: ${c.name.split(' ')[0]}, you owe ${leones(bal)}. Thank you.`
        : bal < 0 ? `${org!.name}: ${c.name.split(' ')[0]}, we owe you ${leones(-bal)}.`
        : `${org!.name}: ${c.name.split(' ')[0]}, you owe nothing. Thank you!`;
      if (wantsStatement) {
        // Newest last, short enough for one or two texts: "12/11 took Le 500", "14/11 paid Le 300".
        const last = [...(rows ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.created_at - b.created_at).slice(-5);
        const lines = last.map((e) => `${String(e.date).slice(8, 10)}/${String(e.date).slice(5, 7)} ${e.type === 'gave' ? 'took' : 'paid'} ${leones(e.amount)}`);
        reply = `${reply}${lines.length ? ` Last: ${lines.join('; ')}.` : ''}`;
      }
    }
    await sendText(g, from, reply);
    await db.from('sms_log').insert({ org_id: orgId, contact_id: c?.id ?? null, kind: 'balance' });
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
});

/** TODAY, OWE or STOCK <item> for an owner or manager, checked by their PIN. */
async function ownerCommand(orgId: string, from: string, cmd: string, pin: string, arg: string): Promise<string> {
  const db = admin();
  const { data: org } = await db.from('orgs').select('name').eq('id', orgId).single();
  const shop = org?.name ?? 'Kopor';
  const who = await checkPhonePin(from, pin);
  if (who === 'locked') return `${shop}: too many wrong PINs. Try again later.`;
  if (who === 'wrong') return `${shop}: wrong PIN.`;
  const { data: m } = await db.from('members').select('id').eq('org_id', orgId).eq('user_id', who.userId).eq('deleted', 0).eq('active', 1).in('role', ['owner', 'manager']).maybeSingle();
  if (!m) return `${shop}: this number cannot ask for the business figures.`;
  const day = new Date().toISOString().slice(0, 10);
  if (cmd === 'today') {
    const { data: tx } = await db.from('transactions').select('type, category, amount, method, items').eq('org_id', orgId).eq('deleted', 0).eq('date', day);
    let sales = 0, cash = 0, spent = 0, cost = 0;
    for (const x of tx ?? []) {
      if (x.type === 'in' && x.category !== 'refund') {
        sales += x.amount; if (x.method === 'cash') cash += x.amount;
        for (const i of (x.items ?? []) as { qty?: number; cost?: number }[]) cost += Number(i.qty ?? 0) * Number(i.cost ?? 0);
      } else if (x.type === 'out' && x.category !== 'stock') spent += x.amount;
    }
    const { count } = await db.from('closings').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('deleted', 0).eq('date', day).eq('kind', 'close');
    return `${shop} today: sales ${leones(sales)} (cash ${leones(cash)}) · spent ${leones(spent)} · profit about ${leones(sales - Math.round(cost) - spent)} · ${count ? 'day closed' : 'day not closed yet'}.`;
  }
  if (cmd === 'owe') {
    const [{ data: rows }, { data: people }] = await Promise.all([
      db.from('ledger').select('contact_id, type, amount').eq('org_id', orgId).eq('deleted', 0).limit(20000),
      db.from('contacts').select('id, name, kind').eq('org_id', orgId).eq('deleted', 0),
    ]);
    const bal = new Map<string, number>();
    for (const e of rows ?? []) bal.set(e.contact_id, (bal.get(e.contact_id) ?? 0) + (e.type === 'gave' ? e.amount : -e.amount));
    const owing = (people ?? []).filter((p) => p.kind !== 'supplier' && (bal.get(p.id) ?? 0) > 0).map((p) => [p.name, bal.get(p.id)!] as const).sort((a, b) => b[1] - a[1]);
    const total = owing.reduce((s, [, v]) => s + v, 0);
    return owing.length ? `${shop}: customers owe ${leones(total)}. Most: ${owing.slice(0, 5).map(([n, v]) => `${n.split(' ')[0]} ${leones(v)}`).join('; ')}.` : `${shop}: nobody owes you.`;
  }
  // stock <item>
  if (!arg) return `${shop}: send STOCK, your PIN and the item, for example STOCK 123456 rice.`;
  const { data: products } = await db.from('products').select('id, name, unit, low_at').eq('org_id', orgId).eq('deleted', 0).ilike('name', `%${arg.replace(/[%_]/g, '')}%`).limit(3);
  if (!products?.length) return `${shop}: no item called "${arg}".`;
  const { data: moves } = await db.from('stock_moves').select('product_id, qty').eq('org_id', orgId).eq('deleted', 0).in('product_id', products.map((p) => p.id));
  const level = (id: string) => (moves ?? []).filter((x) => x.product_id === id).reduce((s, x) => s + Number(x.qty), 0);
  return `${shop}: ${products.map((p) => `${p.name} ${level(p.id)} ${p.unit}${level(p.id) <= Number(p.low_at ?? 0) ? ' (low)' : ''}`).join('; ')}.`;
}
