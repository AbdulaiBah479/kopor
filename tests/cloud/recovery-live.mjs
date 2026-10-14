// LIVE test of PIN recovery and the AI fallback chain against the real Supabase project in .env.local.
// Creates a throwaway account with a made-up 099… number and deletes it at the end.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const phoneDigits = '23299' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const email = `p${phoneDigits}@phone.kopor.app`;
let ok = true;
const check = (name, cond, extra = '') => { console.log(cond ? '✓' : '✗', name, extra); if (!cond) ok = false; };
const invoke = async (fn, body) => {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (error) { const j = await error.context?.json?.().catch(() => null); return { error: j?.error ?? error.message }; }
  return data;
};

const up = await sb.auth.signUp({ email, password: 'kopor-pin-111111', options: { data: { name: 'Kopor Recovery Test', phone: phoneDigits } } });
check('sign up test account', !!up.data.session, up.error?.message ?? '');
const created = await invoke('recover', { action: 'create' });
check('recovery code created', /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(created.code ?? ''), created.error ?? '');
await sb.auth.signOut();

const wrong = await invoke('recover', { action: 'reset', email, code: 'AAAAA-AAAAA', pin: '222222' });
check('wrong code is refused', wrong.error === 'errx.recoverBad', JSON.stringify(wrong));
const reset = await invoke('recover', { action: 'reset', email, code: created.code.toLowerCase(), pin: '222222' });
check('right code (any case) sets the new PIN', reset.ok === true, JSON.stringify(reset));
const oldPin = await sb.auth.signInWithPassword({ email, password: 'kopor-pin-111111' });
check('old PIN no longer works', !!oldPin.error);
const newPin = await sb.auth.signInWithPassword({ email, password: 'kopor-pin-222222' });
check('new PIN signs in', !newPin.error && !!newPin.data.session, newPin.error?.message ?? '');
await sb.auth.signOut();
const reuse = await invoke('recover', { action: 'reset', email, code: created.code, pin: '333333' });
check('used code cannot be reused', reuse.error === 'errx.recoverBad', JSON.stringify(reuse));
await sb.auth.signInWithPassword({ email, password: 'kopor-pin-222222' });

// The AI proxy needs a business membership; a fresh account has none, so it must refuse cleanly (403), not crash.
const ai = await invoke('ai', { messages: [{ role: 'user', content: 'Say OK' }] });
check('AI refuses accounts without a business (no crash)', /member/i.test(ai.error ?? ''), JSON.stringify(ai).slice(0, 120));

const del = await invoke('delete-account', {});
check('test account deleted', !del.error, JSON.stringify(del).slice(0, 120));
console.log(ok ? '\nRecovery live test passed' : '\nRecovery live test FAILED');
process.exit(ok ? 0 : 1);
