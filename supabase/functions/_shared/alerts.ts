// Sends fraud alerts and the weekly report to owners and managers: a phone notification (Web Push) on every phone they
// switched notifications on, and a text from the shop's own phone when text messages are connected.
import { admin } from './util.ts';
import { sendPush, type VapidKeys } from './webpush.ts';
import { gateFor, leones, sendText, sentToday } from './smsgate.ts';
import { normalizeSlPhone } from './momo.ts';
import { sendFcm } from './fcm.ts';

type Lang = 'en' | 'kri' | 'fr';
export interface Alert { id: number; org_id: string; kind: string; who: string; amount: number; detail: string; at: string }

/** The closing summary the database put in the alert (migration 0042). */
const WEEKDAYS: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  kri: ['Sɔnde', 'Mɔnde', 'Tyuzde', 'Wɛnsde', 'Tɔsde', 'Fraide', 'Satide'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
};
const weekday = (date: string, lang: Lang) => WEEKDAYS[lang][new Date(`${date}T12:00:00Z`).getUTCDay()] ?? '';

function day(a: Alert) {
  let d: Record<string, unknown> = {};
  try { d = JSON.parse(a.detail); } catch { /* an older alert without a summary */ }
  const n = (k: string) => Number(d[k] ?? 0) || 0;
  // "Unusual day": today's sales against the average of the same weekday over the last 4 weeks.
  const usual = n('usual'), sales = n('sales');
  const trend = usual > 0 && sales < usual * 0.6 ? 'low' : usual > 0 && sales > usual * 1.4 ? 'high' : '';
  return { sales, profit: sales - n('cost') - n('expenses'), diff: n('diff'), owed: Math.max(0, n('owed')), warnings: n('warnings'), date: String(d.date ?? ''), branch: d.branch ? ` · ${d.branch}` : '', usual, trend };
}

const L = {
  en: {
    short: (a: Alert) => [`Cash short: ${leones(a.amount)}`, a.detail.includes('handover') ? `${a.who || 'Someone'} handed over the drawer ${leones(a.amount)} short.` : `${a.who || 'Someone'} closed ${a.detail.slice(0, 10)} short by ${leones(a.amount)}${a.detail.includes('momo') ? ' (mobile money too)' : ''}.`],
    reversal: (a: Alert) => [`Payment pulled back: ${leones(a.amount)}`, a.detail === 'outside' ? `A mobile money payment of ${leones(a.amount)} was reversed. Check who paid it.` : `A customer${a.who ? ` (${a.who})` : ''} had ${leones(a.amount)} reversed after paying${a.detail && a.detail !== 'group' ? ` (${a.detail})` : ''}. Kopor has put it back as unpaid.`],
    closing: (a: Alert) => { const d = day(a); return [`Day closed${d.branch}`, `${a.who || 'Someone'} closed ${d.date}. Sales ${leones(d.sales)} · profit about ${leones(d.profit)} · ${d.diff < 0 ? `cash short ${leones(-d.diff)}` : d.diff > 0 ? `cash over ${leones(d.diff)}` : 'cash correct'} · customers owe ${leones(d.owed)} · ${d.warnings ? `${d.warnings} warning${d.warnings > 1 ? 's' : ''}` : 'no warnings'}.${d.trend === 'low' ? ` Sales are much lower than a usual ${weekday(d.date, 'en')} (${leones(d.usual)}).` : d.trend === 'high' ? ` Better than a usual ${weekday(d.date, 'en')} (${leones(d.usual)})!` : ''}`]; },
    notClosed: (a: Alert) => [`Day not closed${a.detail ? ` · ${a.detail}` : ''}`, `Sales of ${leones(a.amount)} today, but nobody has counted the drawer. Ask the cashier to close the day now.`],
    test: () => ['Test notification', 'Kopor alerts are working on this phone. You can ignore this message.'],
    approval: (a: Alert) => ['Approval needed', `${a.who} asks you to approve: ${a.detail}. Open Fraud watch.`],
    newDevice: (a: Alert) => ['New phone signed in', `${a.who} signed in on a new phone (${a.detail}). If this was not them, sign it out in Team.`],
    refund: (a: Alert) => [`Refund: ${leones(a.amount)}`, `${a.who || 'Someone'} gave a refund of ${leones(a.amount)}${a.detail === 'no-sale' ? ' with no sale linked to it' : ''}.`],
    deleted: (a: Alert) => [`Deleted: ${leones(a.amount)}`, `${a.who || 'Someone'} deleted a ${a.detail === 'ledger' ? 'credit entry' : 'sale'} of ${leones(a.amount)}.`],
    away: (a: Alert) => ['Tap-in away from the shop', `${a.who} tapped in ${a.detail} m from the shop.`],
    left: (a: Alert) => ['Left the shop area', `${a.who} is about ${a.detail} m from the shop during working hours.`],
    fake: (a: Alert) => ['Fake location app', `${a.who}'s phone is sending a position from a fake-GPS app.`],
    weekly: (n: string) => `${n}: last week`,
    monthly: (n: string, m: string) => `${n}: ${m}`,
    month: (s: string, e: string, p: string, ls: string, lp: string) => `Sales ${s} · spending ${e} · profit about ${p}. The month before: sales ${ls}, profit about ${lp}.`,
    week: (s: string, e: string, p: string, late: string, warn: string) => `Sales ${s} · expenses ${e} · profit about ${p}.${late ? ` Late/absent: ${late}.` : ''}${warn ? ` Warnings: ${warn}.` : ' No warnings.'}`,
  },
  kri: {
    reversal: (a: Alert) => [`Dɛn pul pemɛnt bak: ${leones(a.amount)}`, a.detail === 'outside' ? `Dɛn pul mobayl mɔni pemɛnt fɔ ${leones(a.amount)} bak. Chɛk udat pe am.` : `Kɔstɔma${a.who ? ` (${a.who})` : ''} pul ${leones(a.amount)} bak afta i pe${a.detail && a.detail !== 'group' ? ` (${a.detail})` : ''}. Kopor dɔn mek am nɔ pe yet.`],
    closing: (a: Alert) => { const d = day(a); return [`Dɛn klos di de${d.branch}`, `${a.who || 'Sɔmbɔdi'} klos ${d.date}. Sel ${leones(d.sales)} · prɔfit lɛk ${leones(d.profit)} · ${d.diff < 0 ? `kach shɔt ${leones(-d.diff)}` : d.diff > 0 ? `kach ɛkstra ${leones(d.diff)}` : 'kach kɔrɛkt'} · kɔstɔma dɛn gɛt fɔ pe ${leones(d.owed)} · ${d.warnings ? `${d.warnings} wɔnin` : 'no wɔnin'}.${d.trend === 'low' ? ` Sɛl smɔl pas aw i kin bi ${weekday(d.date, 'kri')} (${leones(d.usual)}).` : d.trend === 'high' ? ` I bɛtɛ pas aw i kin bi ${weekday(d.date, 'kri')} (${leones(d.usual)})!` : ''}`]; },
    notClosed: (a: Alert) => [`Dɛn nɔ klos di de yet${a.detail ? ` · ${a.detail}` : ''}`, `Sɛl fɔ ${leones(a.amount)} tide, bɔt nobɔdi nɔ kɔnt di drɔ. Tɛl di kashia fɔ klos di de naw.`],
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
    monthly: (n: string, m: string) => `${n}: ${m}`,
    month: (s: string, e: string, p: string, ls: string, lp: string) => `Sɛl ${s} · spɛn ${e} · prɔfit lɛk ${p}. Di mɔnt bifo: sɛl ${ls}, prɔfit lɛk ${lp}.`,
    week: (s: string, e: string, p: string, late: string, warn: string) => `Sel ${s} · ɛkspɛns ${e} · prɔfit lɛk ${p}.${late ? ` Lat/nɔ kam: ${late}.` : ''}${warn ? ` Wɔnin: ${warn}.` : ' No wɔnin.'}`,
  },
  fr: {
    reversal: (a: Alert) => [`Paiement annulé : ${leones(a.amount)}`, a.detail === 'outside' ? `Un paiement mobile money de ${leones(a.amount)} a été annulé. Vérifiez qui l’avait payé.` : `Un client${a.who ? ` (${a.who})` : ''} a fait annuler ${leones(a.amount)} après avoir payé${a.detail && a.detail !== 'group' ? ` (${a.detail})` : ''}. Kopor l’a remis comme impayé.`],
    closing: (a: Alert) => { const d = day(a); return [`Journée clôturée${d.branch}`, `${a.who || 'Quelqu’un'} a clôturé le ${d.date}. Ventes ${leones(d.sales)} · bénéfice env. ${leones(d.profit)} · ${d.diff < 0 ? `caisse : ${leones(-d.diff)} manquant` : d.diff > 0 ? `caisse : ${leones(d.diff)} en trop` : 'caisse juste'} · les clients doivent ${leones(d.owed)} · ${d.warnings ? `${d.warnings} signal(aux)` : 'aucun signal'}.${d.trend === 'low' ? ` Ventes bien plus basses qu’un ${weekday(d.date, 'fr')} habituel (${leones(d.usual)}).` : d.trend === 'high' ? ` Mieux qu’un ${weekday(d.date, 'fr')} habituel (${leones(d.usual)}) !` : ''}`]; },
    notClosed: (a: Alert) => [`Journée non clôturée${a.detail ? ` · ${a.detail}` : ''}`, `${leones(a.amount)} de ventes aujourd’hui, mais personne n’a compté la caisse. Demandez au caissier de clôturer maintenant.`],
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
    monthly: (n: string, m: string) => `${n} : ${m}`,
    month: (s: string, e: string, p: string, ls: string, lp: string) => `Ventes ${s} · dépenses ${e} · bénéfice env. ${p}. Le mois d’avant : ventes ${ls}, bénéfice env. ${lp}.`,
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
        return { title: `${r.name}: ${title}`, body, url: `${app}#/${a.kind === 'closing' ? 'report' : a.kind === 'notClosed' ? 'cash' : 'watch'}`, tag: `alert-${a.id}` };
      }, keys, subject);
      const [title, body] = (L.en[kind] as (a: Alert) => string[])(a);
      texted += a.kind === 'closing'
        ? await textAll(org, r.phones, `Kopor (${r.name}): ${title}. ${body}`, 'weekly')
        : await textAll(org, r.phones, `Kopor alert (${r.name}): ${title}. ${body}`, 'alert');
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

const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  kri: ['Jenwari', 'Fɛbwari', 'Mach', 'Ɛpril', 'Me', 'Jun', 'Julay', 'Ɔgɔs', 'Sɛptɛmba', 'Ɔktoba', 'Novɛmba', 'Disɛmba'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};

/** On the 1st (or the first run after it): last month's report to every owner, with the month before. Once a month. */
export async function monthlyReports(keys: VapidKeys, subject: string, app: string, now = new Date()) {
  const db = admin();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = start.toISOString().slice(0, 10);
  const { error: claimed } = await db.from('monthly_runs').insert({ month });
  if (claimed) return { skipped: 'already sent this month' };
  const { data, error } = await db.rpc('kopor_month_report', { s: month });
  if (error) throw new Error(error.message);
  type T = { sales: number; expenses: number; cost: number };
  const profit = (t: T) => Number(t.sales) - Number(t.cost) - Number(t.expenses);
  let sent = 0;
  for (const r of (data ?? []) as { org_id: string; name: string; this_month: T; last_month: T }[]) {
    const rec = await recipients(r.org_id);
    const text = (lang: Lang) => L[lang].month(leones(Number(r.this_month.sales)), leones(Number(r.this_month.expenses)), leones(profit(r.this_month)),
      leones(Number(r.last_month.sales)), leones(profit(r.last_month)));
    const title = (lang: Lang) => L[lang].monthly(r.name, MONTHS[lang][start.getUTCMonth()]);
    sent += await pushAll(rec, (lang) => ({ title: title(lang), body: text(lang), url: `${app}#/pnl`, tag: `monthly-${month}` }), keys, subject);
    sent += await textAll(r.org_id, rec.phones, `Kopor (${title('en')}): ${text('en')}`, 'weekly');
  }
  await db.from('monthly_runs').update({ sent }).eq('month', month);
  return { month, businesses: (data ?? []).length, sent };
}

/** 9 pm: businesses that sold today but nobody closed the day get a "day not closed" alert (once a day). */
export async function notClosed(keys: VapidKeys, subject: string, app: string, now = new Date()) {
  const db = admin();
  const d = now.toISOString().slice(0, 10); // Sierra Leone is on UTC
  const { error: claimed } = await db.from('job_claims').insert({ name: 'notClosed', slot: Math.floor(now.getTime() / 86_400_000) });
  if (claimed) return { skipped: 'already checked today' };
  const { data, error } = await db.rpc('kopor_not_closed', { d });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { org_id: string; branch_id: string | null; sales: number }[];
  const branchIds = rows.map((r) => r.branch_id).filter(Boolean) as string[];
  const { data: branches } = branchIds.length ? await db.from('branches').select('id, name').in('id', branchIds) : { data: [] };
  const names = new Map((branches ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));
  for (const r of rows) {
    await db.rpc('kopor_alert', { o: r.org_id, k: 'notClosed', r: `${d}:${r.branch_id ?? 'all'}`, w: '', a: Number(r.sales), d: r.branch_id ? names.get(r.branch_id) ?? '' : '' });
  }
  if (rows.length) await flushAlerts(keys, subject, app);
  return { date: d, notClosed: rows.length };
}
