// Free reminder notifications (Web Push, no SMS costs). Actions:
//   key                                   -> the public VAPID key browsers need to subscribe
//   subscribe { subscription, scope: 'member', token, memberId, lang }   a group member, from the member link
//   subscribe { subscription, scope: 'org', orgId, lang }                an owner/manager (signed in)
//   unsubscribe { endpoint }
//   run                                   -> send today's reminders; does nothing if today's run already happened,
//                                            so the free daily GitHub job (or anyone) can trigger it safely.
//   alerts { orgId? }                     -> send fraud alerts the database made and has not sent yet (each goes out
//                                            once, so phones after syncing and a backup job can all call it)
//   weekly                                -> last week's report to owners and managers, once per week
import { admin, caller, cors, json, HttpError } from '../_shared/util.ts';
import { generateVapidKeys, sendPush, type VapidKeys } from '../_shared/webpush.ts';
import { flushAlerts, weeklyReports } from '../_shared/alerts.ts';

const SUBJECT = Deno.env.get('PUSH_SUBJECT') ?? 'mailto:babdulai225.2@gmail.com';
const APP = (Deno.env.get('PUBLIC_APP_URL') ?? 'https://abdulaibah479.github.io/kopor/').replace(/\/?$/, '/');

async function vapid(): Promise<VapidKeys> {
  const db = admin();
  const { data } = await db.from('app_keys').select('value').eq('name', 'vapid').maybeSingle();
  if (data?.value) return JSON.parse(data.value);
  // First use: make the key pair on the server and keep it there (never in the code or the repository).
  const keys = await generateVapidKeys();
  const { error } = await db.from('app_keys').insert({ name: 'vapid', value: JSON.stringify(keys) });
  if (error) { // another request made it at the same moment: use that one
    const again = await db.from('app_keys').select('value').eq('name', 'vapid').single();
    return JSON.parse(again.data!.value);
  }
  return keys;
}

const money = (minor: number) => `Le ${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const T = {
  en: {
    due: (g: string, a: string) => [`${g}: payment due today`, `Your contribution of ${a} is due today. Tap to see the group.`],
    loan: (g: string, a: string, late: boolean) => [`${g}: loan ${late ? 'overdue' : 'due'}`, `Your loan repayment of ${a} is ${late ? 'overdue' : 'due soon'}. Tap to see your balance.`],
    org: (n: string, c: number, l: number, d: number) => [`${n}: today in Kopor`, [c && `${c} payment${c > 1 ? 's' : ''} to approve`, l && `${l} group loan${l > 1 ? 's' : ''} due`, d && `${d} customer${d > 1 ? 's' : ''} overdue`].filter(Boolean).join(' · ')],
  },
  kri: {
    due: (g: string, a: string) => [`${g}: fɔ pe tide`, `Yu kɔntribyushɔn we na ${a} fɔ pe tide. Tap fɔ si di grup.`],
    loan: (g: string, a: string, late: boolean) => [`${g}: lɔn ${late ? 'dɔn pas tɛm' : 'fɔ pe'}`, `Yu lɔn pe-bak we na ${a} ${late ? 'dɔn pas tɛm' : 'fɔ pe kwik'}. Tap fɔ si yu balans.`],
    org: (n: string, c: number, l: number, d: number) => [`${n}: tide na Kopor`, [c && `${c} pemɛnt fɔ apruv`, l && `${l} grup lɔn fɔ pe`, d && `${d} kɔstoma dɔn pas tɛm`].filter(Boolean).join(' · ')],
  },
  fr: {
    due: (g: string, a: string) => [`${g} : paiement dû aujourd’hui`, `Votre cotisation de ${a} est due aujourd’hui. Touchez pour voir le groupe.`],
    loan: (g: string, a: string, late: boolean) => [`${g} : prêt ${late ? 'en retard' : 'à rembourser'}`, `Le remboursement de ${a} est ${late ? 'en retard' : 'bientôt dû'}. Touchez pour voir votre solde.`],
    org: (n: string, c: number, l: number, d: number) => [`${n} : aujourd’hui dans Kopor`, [c && `${c} paiement(s) à approuver`, l && `${l} prêt(s) de groupe dû(s)`, d && `${d} client(s) en retard`].filter(Boolean).join(' · ')],
  },
};

interface Digest {
  endpoint: string; p256dh: string; auth: string; lang: 'en' | 'kri' | 'fr'; scope: 'member' | 'org'; org_name: string; group_name: string | null;
  token: string | null; contribution_due: number; loan_owes: number; loan_due: string | null; claims_pending: number; loans_due: number; debts_overdue: number;
}

/** The notifications for one phone today (none when nothing is due). Overdue loans are mentioned every 3 days, not daily. */
function messagesFor(r: Digest, today: string) {
  const t = T[r.lang] ?? T.en;
  const out: { title: string; body: string; url: string; tag: string }[] = [];
  if (r.scope === 'member') {
    const url = `${APP}#/g/${r.token}`;
    if (Number(r.contribution_due) > 0) { const [title, body] = t.due(r.group_name!, money(Number(r.contribution_due))); out.push({ title, body, url, tag: 'due' }); }
    if (Number(r.loan_owes) > 0 && r.loan_due) {
      const days = Math.round((Date.parse(r.loan_due) - Date.parse(today)) / 86_400_000);
      if (days === 0 || days === 1 || (days < 0 && -days % 3 === 0)) { const [title, body] = t.loan(r.group_name!, money(Number(r.loan_owes)), days < 0); out.push({ title, body, url, tag: 'loan' }); }
    }
  } else if (r.claims_pending || r.loans_due || r.debts_overdue) {
    const [title, body] = t.org(r.org_name, r.claims_pending, r.loans_due, r.debts_overdue);
    out.push({ title, body, url: `${APP}#/reminders`, tag: 'org' });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const db = admin();
    switch (body.action) {
      case 'key':
        return json({ publicKey: (await vapid()).publicKey });

      case 'subscribe': {
        const s = body.subscription ?? {};
        const sub = { endpoint: String(s.endpoint ?? ''), p256dh: String(s.keys?.p256dh ?? ''), auth: String(s.keys?.auth ?? '') };
        if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || sub.p256dh.length < 80 || sub.auth.length < 16) throw new HttpError(400, 'Bad subscription');
        const lang = ['en', 'kri', 'fr'].includes(body.lang) ? body.lang : 'en';
        let row: Record<string, unknown>;
        if (body.scope === 'member') {
          // A member needs only the group's secret link and their own name on the list.
          const { data: g } = await db.from('groups').select('id, org_id, members').eq('public_token', String(body.token ?? '')).eq('deleted', 0).maybeSingle();
          if (!g || String(body.token).length < 16 || !(g.members as { id: string }[]).some((m) => m.id === body.memberId)) throw new HttpError(400, 'invalid link');
          row = { ...sub, scope: 'member', org_id: g.org_id, group_id: g.id, member_id: String(body.memberId), user_id: null, lang };
        } else if (body.scope === 'org') {
          const orgId = String(body.orgId ?? '');
          if (!/^[0-9a-f-]{36}$/.test(orgId)) throw new HttpError(400, 'Bad request');
          const { user, level } = await caller(req, orgId);
          if (level < 2) throw new HttpError(403, 'Managers and owners only');
          row = { ...sub, scope: 'org', org_id: orgId, group_id: null, member_id: null, user_id: user.id, lang };
        } else throw new HttpError(400, 'Bad request');
        const { error } = await db.from('push_subscriptions').upsert(row);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }

      case 'alerts': {
        const orgId = body.orgId ? String(body.orgId) : undefined;
        if (orgId && !/^[0-9a-f-]{36}$/.test(orgId)) throw new HttpError(400, 'Bad request');
        return json(await flushAlerts(await vapid(), SUBJECT, APP, orgId));
      }

      case 'weekly':
        return json(await weeklyReports(await vapid(), SUBJECT, APP));

      case 'unsubscribe': {
        await db.from('push_subscriptions').delete().eq('endpoint', String(body.endpoint ?? ''));
        return json({ ok: true });
      }

      case 'run': {
        const today = new Date().toISOString().slice(0, 10); // Sierra Leone is on UTC
        const { error: claimed } = await db.from('push_runs').insert({ day: today });
        if (claimed) return json({ skipped: 'already ran today' });
        const { data, error } = await db.rpc('kopor_push_digest', { d: today });
        if (error) throw new Error(error.message);
        const keys = await vapid();
        let sent = 0, failed = 0;
        for (const r of (data ?? []) as Digest[]) {
          for (const m of messagesFor(r, today)) {
            try {
              const status = await sendPush({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }, m, keys, SUBJECT);
              if (status === 404 || status === 410) { await db.from('push_subscriptions').delete().eq('endpoint', r.endpoint); failed++; }
              else if (status >= 200 && status < 300) sent++; else failed++;
            } catch { failed++; }
          }
          await db.from('push_subscriptions').update({ last_sent: today }).eq('endpoint', r.endpoint);
        }
        await db.from('push_runs').update({ sent, failed }).eq('day', today);
        return json({ sent, failed });
      }
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
