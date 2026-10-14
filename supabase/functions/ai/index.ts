// AI proxy so users don't need their own key. Server keys never reach the phone. Requests go through a chain of
// free providers/models (see _shared/llm.ts) so one provider's limit never stops the app. Rate-limited per business per day.
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { complete } from '../_shared/llm.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const FREE_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? 50);
const PRO_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT_PRO') ?? 500);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u } = await user.auth.getUser();
    if (!u.user) throw new HttpError(401, 'Sign in to use AI');
    const { data: m } = await user.from('members').select('org_id').eq('user_id', u.user.id).eq('active', 1).limit(1).maybeSingle();
    if (!m) throw new HttpError(403, 'Not a member of any business');

    const { messages, vision } = await req.json();
    if (!Array.isArray(messages) || messages.length > 24 || JSON.stringify(messages).length > 2_500_000) throw new HttpError(400, 'Request too large');

    const db = admin();
    const day = new Date().toISOString().slice(0, 10);
    const { data: usage } = await db.from('ai_usage').select('count').eq('org_id', m.org_id).eq('day', day).maybeSingle();
    const { data: pro } = await db.rpc('kopor_is_pro', { o: m.org_id });
    if ((usage?.count ?? 0) >= (pro ? PRO_LIMIT : FREE_LIMIT)) throw new HttpError(429, 'Daily AI limit reached. Kopor will use offline mode until tomorrow, or upgrade to Kopor Pro.');

    const out = await complete(messages, { vision: !!vision });
    // Count only answered requests, so provider outages never use up a business's daily allowance.
    await db.from('ai_usage').upsert({ org_id: m.org_id, day, count: (usage?.count ?? 0) + 1 });
    return json({ content: out.content, provider: out.provider });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 503);
  }
});
