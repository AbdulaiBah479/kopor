// Shared helpers for Kopor Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

export const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

const ALLOWED_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
export const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const admin = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

/** Resolve the caller and their role level in an org (via the same SQL function RLS uses). */
export async function caller(req: Request, orgId: string) {
  const auth = req.headers.get('Authorization') ?? '';
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) throw new HttpError(401, 'errx.signIn');
  const { data: level, error } = await userClient.rpc('kopor_level', { o: orgId });
  if (error) throw new HttpError(403, error.message);
  return { user: u.user, level: Number(level) };
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export function requireLevel(level: number, min: number) {
  if (level < min) throw new HttpError(403, 'errx.role');
}

/* AES-256-GCM encryption for third-party secrets at rest (key from env KOPOR_MASTER_KEY, 32+ chars). */
async function key() {
  const raw = new TextEncoder().encode(env('KOPOR_MASTER_KEY'));
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function seal(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(data)}`;
}
export async function unseal(sealed: string) {
  const [iv, data] = sealed.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(), unb64(data)));
}

export const nowMs = () => Date.now();
export const today = () => new Date().toISOString().slice(0, 10);
export const randomSecret = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
