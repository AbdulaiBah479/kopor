// LIVE check of the AI proxy's provider chain. Usage: node tests/cloud/ai-live.mjs <test phone> <pin>
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [phone, pin] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const intl = '232' + phone.replace(/^0/, '');
const { error } = await sb.auth.signInWithPassword({ email: `p${intl}@phone.kopor.app`, password: `kopor-pin-${pin}` });
if (error) { console.log('sign-in failed', error.message); process.exit(1); }
const t0 = Date.now();
const { data, error: e2 } = await sb.functions.invoke('ai', { body: { messages: [
  { role: 'system', content: 'Answer in Sierra Leone Krio, one short sentence.' },
  { role: 'user', content: 'Aw a go mek mɔ prɔfit na mi shɔp?' },
] } });
const body = e2 ? await e2.context?.json?.().catch(() => null) : data;
console.log(`${Date.now() - t0} ms`, JSON.stringify(body).slice(0, 300));
process.exit(body?.content ? 0 : 1);
