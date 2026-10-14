// Owner dashboard data. Only accounts whose phone number is listed in the KOPOR_ADMIN_PHONES secret
// (comma-separated, international format e.g. 23276123456) get anything back; everyone else gets 403.
//   { action: 'whoami' } -> { admin: boolean }
//   { action: 'stats' }  -> aggregate numbers (no personal data)
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
    if (body.action === 'stats') {
      const { data, error } = await admin().rpc('kopor_admin_stats');
      if (error) throw new Error(error.message);
      return json({ stats: data, at: new Date().toISOString() });
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
