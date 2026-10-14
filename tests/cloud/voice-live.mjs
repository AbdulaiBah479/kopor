// LIVE check: speech to text and chat through the cloud AI as a guest (no account), like the demo business.
// Usage: node tests/cloud/voice-live.mjs <path-to-audio-file>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const body = async (r) => (r.error ? await r.error.context?.json?.().catch(() => ({ error: r.error.message })) : r.data);
let ok = true;

const file = process.argv[2];
const form = new FormData();
form.append('file', new File([readFileSync(file)], basename(file), { type: 'audio/wav' }));
form.append('lang', 'en');
let t0 = Date.now();
const stt = await body(await sb.functions.invoke('ai', { body: form }));
console.log(stt?.text ? '✓' : '✗', `guest speech to text (${Date.now() - t0} ms):`, JSON.stringify(stt));
ok &&= !!stt?.text && /rice/i.test(stt.text);

t0 = Date.now();
const chat = await body(await sb.functions.invoke('ai', { body: { messages: [{ role: 'user', content: 'Reply with the single word OK.' }] } }));
console.log(chat?.content ? '✓' : '✗', `guest chat (${Date.now() - t0} ms):`, JSON.stringify(chat).slice(0, 120));
ok &&= !!chat?.content;
process.exit(ok ? 0 : 1);
