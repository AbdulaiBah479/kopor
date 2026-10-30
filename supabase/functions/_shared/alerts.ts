// Sends fraud alerts and the weekly report to owners and managers: a phone notification (Web Push) on every phone they
// switched notifications on, and a text from the shop's own phone when text messages are connected.
import { admin } from './util.ts';
import { sendPush, type VapidKeys } from './webpush.ts';
import { gateFor, leones, sendText, sentToday } from './smsgate.ts';
import { normalizeSlPhone } from './momo.ts';
import { sendFcm } from './fcm.ts';

type Lang = 'en' | 'kri' | 'fr';
export interface Alert { id: number; org_id: string; kind: string; who: string; amount: number; detail: string; at: string }

const L = {
  en: {
    short: (a: Alert) => [`Cash short: ${leones(a.amount)}`, a.detail.includes('handover') ? `${a.who || 'Someone'} handed over the drawer ${leones(a.amount)} short.` : `${a.who || 'Someone'} closed ${a.detail.slice(0, 10)} short by ${leones(a.amount)}${a.detail.includes('momo') ? ' (mobile money too)' : ''}.`],
    test: () => ['Test notification', 'Kopor alerts are working on this phone. You can ignore this message.'],
    approval: (a: Alert) => ['Approval needed', `${a.who} asks you to approve: ${a.detail}. Open Fraud watch.`],
    newDevice: (a: Alert) => ['New phone signed in', `${a.who} signed in on a new phone (${a.detail}). If this was not them, sign it out in Team.`],
    refund: (a: Alert) => [`Refund: ${leones(a.amount)}`, `${a.who || 'Someone'} gave a refund of ${leones(a.amount)}${a.detail === 'no-sale' ? ' with no sale linked to it' : ''}.`],
    deleted: (a: Alert) => [`Deleted: ${leones(a.amount)}`, `${a.who || 'Someone'} deleted a ${a.detail === 'ledger' ? 'credit entry' : 'sale'} of ${leones(a.amount)}.`],
    away: (a: Alert) => ['Tap-in away from the shop', `${a.who} tapped in ${a.detail} m from the shop.`],
    left: (a: Alert) => ['Left the shop area', `${a.who} is about ${a.detail} m from the shop during working hours.`],
    fake: (a: Alert) => ['Fake location app', `${a.who}'s phone is sending a position from a fake-GPS app.`],
    weekly: (n: string) => `${n}: last week`,
    week: (s: string, e: string, p: string, late: string, warn: string) => `Sales ${s} · expenses ${e} · profit about ${p}.${late ? ` Late/absent: ${late}.` : ''}${warn ? ` Warnings: ${warn}.` : ' No warnings.'}`,
  },
  kri: {
    test: () => ['Tɛst nɔtifikeshɔn', 'Kopor wɔnin de wok na dis fon. Yu kin lɛf dis mɛsej.'],
    approval: (a: Alert) => ['Yu fɔ gri', `${a.who} de aks yu fɔ gri: ${a.detail}. Opin Fraud watch.`],
    newDevice: (a: Alert) => ['Nyu fon dɔn sayn in', `${a.who} sayn in pan nyu fon (${a.detail}). If nɔto am, sayn am aut na Team.`],
    refund: (a: Alert) => [`Gi mɔni bak: ${leones(a.amount)}`, `${a.who || 'Sɔmbɔdi'} gi ${leones(a.amount)} bak${a.detail === 'no-sale' ? ' we nɔ gɛt sel' : ''}.`],
    short: (a: Alert) => [`Mɔni nɔ kɔmplit: ${leones(a.amount)}`, `${a.who || 'Sɔmbɔdi'} klos ${a.detail.slice(0, 10)} ɛn ${leones(a.amount)} nɔ de${a.detail.includes('momo') ? ' (mobayl mɔni bak)' : ''}.`],
    deleted: (a: Alert) => [`Dɛn dilit: ${leones(a.amount)}`, `${a.who || 'Sɔmbɔdi'} dilit ${a.detail === 'ledger' ? 'kredit' : 'sel'} we na ${leones(a.amount)}.`],
    away: (a: Alert) => ['Tap in fa frɔm di shɔp', `${a.who} tap in ${a.detail} m frɔm di shɔp.`],
    left: (a: Alert) => ['Lɛf di shɔp eria', `${a.who} de lɛk ${a.detail} m frɔm di shɔp na wok awa.`],
    fake: (a: Alert) => ['Fek lokeshɔn ap', `${a.who} in fon de sɛn lokeshɔn frɔm fek GPS ap.`],
    weekly: (n: string) => `${n}: las wik`,
    week: (s: string, e: string, p: string, late: string, warn: string) => `Sel ${s} · ɛkspɛns ${e} · prɔfit lɛk ${p}.${late ? ` Lat/nɔ kam: ${late}.` : ''}${warn ? ` Wɔnin: ${warn}.` : ' No wɔnin.'}`,
  },
  fr: {
    test: () => ['Notification de test', 'Les alertes Kopor fonctionnent sur ce téléphone. Vous pouvez ignorer ce message.'],
    approval: (a: Alert) => ['Approbation demandée', `${a.who} vous demande d’approuver : ${a.detail}. Ouvrez Fraud watch.`],
    newDevice: (a: Alert) => ['Nouveau téléphone connecté', `${a.who} s’est connecté sur un nouveau téléphone (${a.detail}). Si ce n’est pas lui, déconnectez-le dans Équipe.`],
    refund: (a: Alert) => [`Remboursement : ${leones(a.amount)}`, `${a.who || 'Quelqu’un'} a remboursé ${leones(a.amount)}${a.detail === 'no-sale' ? ' sans vente liée' : ''}.`],
    short: (a: Alert) => [`Caisse manquante : ${leones(a.amount)}`, `${a.who || 'Quelqu’un'} a clôturé le ${a.detail.slice(0, 10)} avec ${leones(a.amount)} en moins${a.detail.includes('momo') ? ' (mobile money aussi)' : ''}.`],
    deleted: (a: Alert) => [`Supprimé : ${leones(a.amount)}`, `${a.who || 'Quelqu’un'} a supprimé ${a.detail === 'ledger' ? 'un crédit' : 'une vente'} de ${leones(a.amount)}.`],
    away: (a: Alert) => ['Pointage loin de la boutique', `${a.who} a pointé à ${a.detail} m de la boutique.`],
    left: (a: Alert) => ['A quitté la zone de la boutique', `${a.who} est à environ ${a.detail} m de la boutique pendant les heures de travail.`],
    fake: (a: Alert) => ['Appli de fausse position', `Le téléphone de ${a.who} envoie une position d’une appli de faux GPS.`],
    weekly: (n: string) => `${n} : la semaine dernière`,
    week: (s: string, e: string, p: string, late: string, warn: string) => `Ventes ${s} · dépenses ${e} · bénéfice env. ${p}.${late ? ` Retards/absences : ${late}.` : ''}${warn ? ` Signaux : ${warn}.` : ' Aucun signal.'}`,
  },
};

interface Sub { endpoint: string; p256dh: string; auth: string; lang: Lang }

async function recipients(orgId: string) {
  const db = admin();
  const [{ data: subs }, { data: members }, { data: org }, { data: fcm }] = await Promise.all([
    db.from('push_subscriptions').select('endpoint, p256dh, auth, lang').eq('org_id', orgId).eq('scope', 'org'),
    db.from('members').select('phone, role').eq('org_id', orgId).eq('deleted', 0).eq('active', 1).in('role', ['owner', 'manager']),
    db.from('orgs').select('name, phone').eq('id', orgId).single(),
    db.from('fcm_tokens').select('token, lang').eq('org_id', orgId),
  ]);
  const phones = new Set<string>();
  for (const m of members ?? []) { const p = normalizeSlPhone(m.phone ?? ''); if (p) phones.add(p); }
  return { subs: (subs ?? []) as Sub[], fcm: (fcm ?? []) as { token: string; lang: Lang }[], phones: [...phones], name: org?.name ?? 'Kopor' };
}

/** Phone notifications: Web Push (browsers, installed web app) and Firebase (the Android app). */
async function pushAll(r: { subs: Sub[]; fcm: { token: string; lang: Lang }[] }, msg: (lang: Lang) => { title: string; body: string; url: string; tag: string }, keys: VapidKeys, subject: string) {
  const db = admin();
  let sent = 0;
  for (const f of r.fcm) {
    const m = msg(L[f.lang] ? f.lang : 'en');
    const res = await sendFcm(f.token, { ...m, url: m.url.slice(m.url.indexOf('#')) });
    if (res === 'ok') sent++;
    else if (res === 'gone') await db.from('fcm_tokens').delete().eq('token', f.token);
  }
  for (const s of r.subs) {
    try {
      const status = await sendPush(s, msg(L[s.lang] ? s.lang : 'en'), keys, subject);
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else if (status >= 200 && status < 300) sent++;
    } catch { /* one phone failing must not stop the others */ }
  }
  return sent;
}

/** Texts from the shop's phone, within its daily limit. The owner's language for texts is English (short, clear). */
async function textAll(orgId: string, phones: string[], text: string, kind: 'alert' | 'weekly') {
  const g = await gateFor(orgId);
  if (!g || !phones.length) return 0;
  let left = g.limit - (await sentToday(orgId)), sent = 0;
  for (const to of phones) {
    if (left-- <= 0) break;
    let ok = true;
    try { await sendText(g, to, text); sent++; } catch (e) { ok = false; console.error('alert sms', orgId, e); }
    await admin().from('sms_log').insert({ org_id: orgId, kind, ok });
    if (!ok) break;
  }
  return sent;
}

/** Send every alert not sent yet (for one business, or all). Each alert goes out once. */
export async function flushAlerts(keys: VapidKeys, subject: string, app: string, orgId?: string) {
  const db = admin();
  let q = db.from('alerts').select('id, org_id, kind, who, amount, detail, at').is('sent_at', null)
    .gte('at', new Date(Date.now() - 86_400_000).toISOString()).order('id').limit(200);
  if (orgId) q = q.eq('org_id', orgId);
  const { data } = await q;
  const alerts = (data ?? []) as Alert[];
  if (!alerts.length) return { alerts: 0, pushed: 0, texted: 0 };
  // Claim them first, so two calls at the same moment never send the same alert twice.
  const { data: claimed } = await db.from('alerts').update({ sent_at: new Date().toISOString() }).in('id', alerts.map((a) => a.id)).is('sent_at', null).select('id');
  const mine = new Set((claimed ?? []).map((c) => c.id));
  let pushed = 0, texted = 0;
  const byOrg = new Map<string, Alert[]>();
  for (const a of alerts) if (mine.has(a.id)) byOrg.set(a.org_id, [...(byOrg.get(a.org_id) ?? []), a]);
  for (const [org, list] of byOrg) {
    const r = await recipients(org);
    for (const a of list) {
      const kind = a.kind as keyof typeof L.en;
      pushed += await pushAll(r, (lang) => {
        const [title, body] = (L[lang][kind] as (a: Alert) => string[])(a);
        return { title: `${r.name}: ${title}`, body, url: `${app}#/watch`, tag: `alert-${a.id}` };
      }, keys, subject);
      const [title, body] = (L.en[kind] as (a: Alert) => string[])(a);
      texted += await textAll(org, r.phones, `Kopor alert (${r.name}): ${title}. ${body}`, 'alert');
    }
  }
  return { alerts: mine.size, pushed, texted };
}

/** Monday's report for last week (Monday to Sunday), once per week for every business. */
export async function weeklyReports(keys: VapidKeys, subject: string, app: string, now = new Date()) {
  const db = admin();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const start = new Date(monday); start.setUTCDate(monday.getUTCDate() - 7);
  const week = start.toISOString().slice(0, 10);
  const { error: claimed } = await db.from('weekly_runs').insert({ week });
  if (claimed) return { skipped: 'already sent this week' };
  const { data, error } = await db.rpc('kopor_weekly_report', { s: week });
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const r of (data ?? []) as { org_id: string; name: string; sales: number; expenses: number; cost: number; people: { name: string; late: number; absent: number }[]; warnings: { who: string; n: number }[] }[]) {
    const rec = await recipients(r.org_id);
    const late = r.people.slice(0, 4).map((p) => `${p.name.split(' ')[0]} ${p.late}/${p.absent}`).join(', ');
    const warn = r.warnings.slice(0, 4).map((w) => `${(w.who || '?').split(' ')[0]} ×${w.n}`).join(', ');
    const profit = Number(r.sales) - Number(r.cost) - Number(r.expenses);
    const text = (lang: Lang) => L[lang].week(leones(Number(r.sales)), leones(Number(r.expenses)), leones(profit), late, warn);
    sent += await pushAll(rec, (lang) => ({ title: L[lang].weekly(r.name), body: text(lang), url: `${app}#/report`, tag: `weekly-${week}` }), keys, subject);
    sent += await textAll(r.org_id, rec.phones, `Kopor weekly (${r.name}): ${text('en')}`, 'weekly');
  }
  await db.from('weekly_runs').update({ sent }).eq('week', week);
  return { week, businesses: (data ?? []).length, sent };
}
