// Deletes the caller's account (Google Play "account deletion" requirement).
// Removes them from every business, closes businesses where they were the only owner, then deletes the login.
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: u } = await user.auth.getUser();
    if (!u.user) throw new HttpError(401, 'errx.signIn');
    const db = admin();
    const { error } = await db.rpc('kopor_forget_user', { uid: u.user.id });
    if (error) throw new HttpError(500, error.message);
    const del = await db.auth.admin.deleteUser(u.user.id);
    if (del.error) throw new HttpError(500, del.error.message);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
