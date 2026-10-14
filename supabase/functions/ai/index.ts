// AI proxy so users don't need their own key. Server keys never reach the phone. Requests go through a chain of
// free providers/models (see _shared/llm.ts) so one provider's limit never stops the app.
//   JSON body  { messages, vision }  -> chat completion
//   multipart  file=<audio>, lang    -> speech to text (Whisper)
// Signed-in businesses get a daily allowance per business; everyone else a smaller one per network address.
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { complete, transcribe } from '../_shared/llm.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const FREE_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? 50);
const PRO_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT_PRO') ?? 500);
const ANON_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT_ANON') ?? 20);
const MAX_AUDIO = 6 * 1024 * 1024; // about a minute of speech

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Who is asking, and how much they may still use today. */
async function quota(req: Request) {
  const db = admin();
  const day = new Date().toISOString().slice(0, 10);
  const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: u } = await user.auth.getUser();
  const { data: m } = u.user ? await user.from('members').select('org_id').eq('user_id', u.user.id).eq('active', 1).limit(1).maybeSingle() : { data: null };
  if (m) {
    const { data: usage } = await db.from('ai_usage').select('count').eq('org_id', m.org_id).eq('day', day).maybeSingle();
    const { data: pro } = await db.rpc('kopor_is_pro', { o: m.org_id });
    const used = usage?.count ?? 0;
    if (used >= (pro ? PRO_LIMIT : FREE_LIMIT)) throw new HttpError(429, 'Daily AI limit reached. Kopor will use offline mode until tomorrow, or upgrade to Kopor Pro.');
    return { bump: () => db.from('ai_usage').upsert({ org_id: m.org_id, day, count: used + 1 }) };
  }
  // No business account yet: count per hashed network address (salted, never stored in clear).
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  const key = await sha256(`${env('SUPABASE_URL')}|${day}|${ip}`);
  const { data: usage } = await db.from('ai_usage_anon').select('count').eq('key', key).eq('day', day).maybeSingle();
  const used = usage?.count ?? 0;
  if (used >= ANON_LIMIT) throw new HttpError(429, 'Daily free AI limit reached on this network. Create a free Kopor account for more.');
  return {
    bump: async () => {
      await db.from('ai_usage_anon').upsert({ key, day, count: used + 1 });
      if (Math.random() < 0.02) await db.rpc('kopor_ai_anon_cleanup');
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const q = await quota(req);

    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size < 1000) throw new HttpError(400, 'No audio received');
      if (file.size > MAX_AUDIO) throw new HttpError(413, 'Recording too long. Keep it under a minute.');
      const out = await transcribe(file, String(form.get('lang') ?? 'en'));
      await q.bump();
      return json(out);
    }

    const { messages, vision } = await req.json();
    if (!Array.isArray(messages) || messages.length > 24 || JSON.stringify(messages).length > 2_500_000) throw new HttpError(400, 'Request too large');
    const out = await complete(messages, { vision: !!vision });
    // Count only answered requests, so provider outages never use up anyone's daily allowance.
    await q.bump();
    return json({ content: out.content, provider: out.provider });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 503);
  }
});
