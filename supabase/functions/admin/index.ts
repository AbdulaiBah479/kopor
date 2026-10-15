// Owner dashboard data. Only accounts whose phone number is listed in the KOPOR_ADMIN_PHONES secret
// (comma-separated, international format e.g. 23276123456) get anything back; everyone else gets 403.
//   { action: 'whoami' }                       -> { admin: boolean }
//   { action: 'stats' }                        -> aggregate numbers (no personal data) + reports waiting
//   { action: 'reports' }                      -> latest 100 problem reports and complaints
//   { action: 'report', id, status, reply? }   -> mark a report seen/resolved, with an optional note
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

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

    switch (body.action) {
      case 'stats': {
        const { data, error } = await db.rpc('kopor_admin_stats');
        if (error) throw new Error(error.message);
        const { data: waiting } = await db.rpc('kopor_admin_reports_new');
        return json({ stats: { ...data, reports_waiting: waiting ?? 0 }, at: new Date().toISOString() });
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
        return json({ ok: true });
      }
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
