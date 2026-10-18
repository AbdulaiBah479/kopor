// Owner dashboard (back office). Only accounts whose phone number is listed in the KOPOR_ADMIN_PHONES secret
// (comma-separated, international format e.g. 23276123456) get anything back; everyone else gets 403.
//   { action: 'whoami' }                        -> { admin: boolean }
//   { action: 'stats' }                         -> aggregate numbers (no personal data), 14-day activity, server health
//   { action: 'reports' }                       -> latest 100 problem reports and complaints
//   { action: 'report', id, status, reply? }    -> mark a report seen/resolved, with an optional note
//   { action: 'lookup', phone }                 -> one account: joined, last sign-in, businesses, locked or not
//   { action: 'unlock', phone }                 -> lift a wrong-PIN lock
//   { action: 'recovery', phone }               -> a new one-time recovery code, to give the person after checking it is them
//   { action: 'pro', orgId, months }            -> give Pro for N months (0 = back to free), e.g. for testers
//   { action: 'log' }                           -> the last 50 support actions
// Every change is written to admin_log with the administrator's phone number.
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { issueCode, lockKey } from '../_shared/recovery.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const DAY = 86_400_000;
/** Same rules as the app's intlPhone (src/lib/phone.ts), Sierra Leone by default. */
function intl(phone: unknown): string {
  const d = String(phone ?? '').replace(/[^\d+]/g, '');
  const n = d.startsWith('+') ? d.slice(1) : d.startsWith('00') ? d.slice(2) : d.startsWith('232') && d.length > 9 ? d : d.startsWith('0') ? '232' + d.slice(1) : '232' + d;
  if (!/^\d{10,15}$/.test(n)) throw new HttpError(400, 'Give a valid phone number');
  return n;
}
const emailOf = (n: string) => `p${n}@phone.kopor.app`;
const AI_KEYS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'MISTRAL_API_KEY', 'GITHUB_MODELS_TOKEN', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'SAMBANOVA_API_KEY', 'HF_TOKEN', 'CLOUDFLARE_API_TOKEN', 'AI_API_KEY'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: u } = await user.auth.getUser();
    const phone = u.user?.email?.match(/^p(\d+)@phone\.kopor\.app$/)?.[1];
    const admins = (Deno.env.get('KOPOR_ADMIN_PHONES') ?? '').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
    const isAdmin = !!phone && admins.includes(phone);
    if (body.action === 'whoami') return json({ admin: isAdmin });
    if (!isAdmin) throw new HttpError(403, 'Not an app administrator');
    const db = admin();
    const log = async (action: string, target: string, detail = '') => {
      const { error } = await db.from('admin_log').insert({ admin_phone: phone, action, target, detail });
      if (error) console.error('admin_log', error.message);
    };
    const account = async (n: string) => {
      const { data, error } = await db.rpc('kopor_admin_account', { e: emailOf(n) });
      if (error) throw new Error(error.message);
      if (!data) throw new HttpError(404, `No Kopor account uses +${n}`);
      return data as { id: string } & Record<string, unknown>;
    };

    switch (body.action) {
      case 'stats': {
        const [{ data, error }, { data: waiting }, { data: activity }] = await Promise.all([
          db.rpc('kopor_admin_stats'), db.rpc('kopor_admin_reports_new'), db.rpc('kopor_admin_activity'),
        ]);
        if (error) throw new Error(error.message);
        const has = (k: string) => !!Deno.env.get(k);
        const health = {
          ai: AI_KEYS.filter(has).map((k) => k.replace(/_(API_KEY|TOKEN|MODELS_TOKEN)$/, '').toLowerCase()),
          voice: has('GROQ_API_KEY') || has('STT_API_KEY'), voice_backup: has('CLOUDFLARE_ACCOUNT_ID') && has('CLOUDFLARE_API_TOKEN'),
          // payments = businesses can connect their own Monime; pro_billing = Kopor can sell Pro through Monime.
          pin_pepper: has('KOPOR_PIN_PEPPER'), payments: has('KOPOR_MASTER_KEY'), pro_billing: has('KOPOR_MONIME_TOKEN') && has('KOPOR_MONIME_SPACE_ID'),
        };
        return json({ stats: { ...data, reports_waiting: waiting ?? 0, activity_14d: activity ?? [] }, health, at: new Date().toISOString() });
      }
      case 'reports': {
        const { data, error } = await db.from('reports').select('id, created_at, kind, message, contact, about, status, reply, app_info')
          .order('status', { ascending: true }).order('created_at', { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        return json({ reports: data });
      }
      case 'report': {
        const status = String(body.status ?? '');
        if (!/^[0-9a-f-]{36}$/.test(String(body.id)) || !['seen', 'resolved'].includes(status)) throw new HttpError(400, 'Bad request');
        const { error } = await db.from('reports').update({ status, reply: String(body.reply ?? '').slice(0, 2000) }).eq('id', body.id);
        if (error) throw new Error(error.message);
        await log(`report:${status}`, String(body.id), String(body.reply ?? '').slice(0, 200));
        return json({ ok: true });
      }
      case 'lookup': {
        const n = intl(body.phone);
        const a = await account(n);
        await log('lookup', `+${n}`);
        return json({ account: { ...a, phone: n } });
      }
      case 'unlock': {
        const n = intl(body.phone);
        const a = await account(n);
        await db.from('pin_attempts').delete().eq('key', await lockKey(emailOf(n)));
        await db.from('recovery_codes').update({ attempts: 0, locked_until: null }).eq('user_id', a.id);
        await log('unlock', `+${n}`);
        return json({ ok: true });
      }
      case 'recovery': {
        const n = intl(body.phone);
        const a = await account(n);
        const code = await issueCode(db, a.id);
        await db.from('pin_attempts').delete().eq('key', await lockKey(emailOf(n)));
        await log('recovery-code', `+${n}`);
        return json({ code, phone: n });
      }
      case 'pro': {
        const months = Math.round(Number(body.months));
        if (!/^[0-9a-f-]{36}$/.test(String(body.orgId)) || !(months >= 0 && months <= 24)) throw new HttpError(400, 'Bad request');
        const { data: org, error: e1 } = await db.from('orgs').select('name, plan, plan_until').eq('id', body.orgId).maybeSingle();
        if (e1) throw new Error(e1.message);
        if (!org) throw new HttpError(404, 'Business not found');
        const now = Date.now();
        const patch = months === 0 ? { plan: 'free', plan_until: null } : { plan: 'pro', plan_until: Math.max(now, Number(org.plan_until ?? 0)) + months * 30 * DAY };
        // updated_at moves forward so phones pick up the change on their next sync.
        const { error } = await db.from('orgs').update({ ...patch, updated_at: now }).eq('id', body.orgId);
        if (error) throw new Error(error.message);
        await log(months ? 'pro:give' : 'pro:remove', String(org.name), months ? `${months} months` : '');
        return json({ ok: true, ...patch });
      }
      case 'log': {
        const { data, error } = await db.from('admin_log').select('at, admin_phone, action, target, detail').order('at', { ascending: false }).limit(50);
        if (error) throw new Error(error.message);
        return json({ log: data });
      }
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
