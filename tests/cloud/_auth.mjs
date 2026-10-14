// Shared helpers for LIVE tests: Supabase client from .env.local and PIN sign-up/sign-in through the auth-pin function
// (the same path the app uses; direct Supabase Auth sign-ups are disabled).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
export const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
export const testEmail = () => `p23299${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}@phone.kopor.app`;

export async function invoke(sb, fn, body) {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (error) { const j = await error.context?.json?.().catch(() => null); return { error: j?.error ?? error.message }; }
  return data;
}

/** Sign up or sign in with a PIN; on success the client holds the session. Returns { error } on failure. */
export async function pinAuth(sb, action, email, pin, name = 'Kopor Cloud Test') {
  const r = await invoke(sb, 'auth-pin', { action, email, pin, name, phone: email.slice(1, email.indexOf('@')) });
  if (!r.access_token) return r;
  const { error } = await sb.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
  return error ? { error: error.message } : { ok: true };
}
