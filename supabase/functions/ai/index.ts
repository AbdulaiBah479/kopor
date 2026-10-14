// AI proxy so users don't need their own key. The server key (GROQ_API_KEY or any OpenAI-compatible
// AI_API_KEY/AI_BASE_URL) never reaches the phone. Rate-limited per business per day.
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const FREE_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? 30);
const PRO_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT_PRO') ?? 300);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u } = await user.auth.getUser();
    if (!u.user) throw new HttpError(401, 'Sign in to use AI');
    const { data: m } = await user.from('members').select('org_id').eq('user_id', u.user.id).eq('active', 1).limit(1).maybeSingle();
    if (!m) throw new HttpError(403, 'Not a member of any business');

    const db = admin();
    const day = new Date().toISOString().slice(0, 10);
    const { data: usage } = await db.from('ai_usage').select('count').eq('org_id', m.org_id).eq('day', day).maybeSingle();
    const { data: pro } = await db.rpc('kopor_is_pro', { o: m.org_id });
    if ((usage?.count ?? 0) >= (pro ? PRO_LIMIT : FREE_LIMIT)) throw new HttpError(429, 'Daily AI limit reached. Try again tomorrow or upgrade to Kopor Pro.');
    await db.from('ai_usage').upsert({ org_id: m.org_id, day, count: (usage?.count ?? 0) + 1 });

    const { messages, vision } = await req.json();
    if (!Array.isArray(messages) || messages.length > 24 || JSON.stringify(messages).length > 2_500_000) throw new HttpError(400, 'Request too large');
    const base = Deno.env.get('AI_BASE_URL') ?? 'https://api.groq.com/openai/v1';
    const key = Deno.env.get('AI_API_KEY') ?? env('GROQ_API_KEY');
    const model = vision ? (Deno.env.get('AI_VISION_MODEL') ?? 'meta-llama/llama-4-scout-17b-16e-instruct') : (Deno.env.get('AI_MODEL') ?? 'llama-3.3-70b-versatile');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 800 }),
    });
    if (!res.ok) throw new HttpError(502, `AI provider error ${res.status}`);
    const j = await res.json();
    return json({ content: j.choices?.[0]?.message?.content ?? '' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
