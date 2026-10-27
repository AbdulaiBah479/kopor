// Supabase client. Configured from build env (VITE_SUPABASE_*) or at runtime from Settings,
// so a deployed app can be pointed at a project without rebuilding. Without config Kopor runs fully offline.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMeta, setMeta } from '@/db/repo';

export interface CloudConfig { url: string; anonKey: string }
let client: SupabaseClient | null = null;
let clientKey = '';
let creating: Promise<SupabaseClient> | null = null;
let anon: SupabaseClient | null = null;

export async function getCloudConfig(): Promise<CloudConfig | null> {
  const env = { url: import.meta.env.VITE_SUPABASE_URL as string | undefined, anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined };
  if (env.url && env.anonKey) return { url: env.url, anonKey: env.anonKey };
  return getMeta<CloudConfig | null>('cloud', null);
}

export async function setCloudConfig(cfg: CloudConfig | null) {
  if (cfg && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.url.trim())) throw new Error('err.cloudUrl');
  await setMeta('cloud', cfg ? { url: cfg.url.trim().replace(/\/$/, ''), anonKey: cfg.anonKey.trim() } : null);
  client = null;
}

export async function getSupabase(): Promise<SupabaseClient | null> {
  const cfg = await getCloudConfig();
  if (!cfg) return null;
  const key = cfg.url + cfg.anonKey;
  if (client && clientKey === key) return client;
  // Loaded on demand: offline-only users never download the cloud library. Callers arriving while it loads wait for
  // the same client (two clients on one sign-in can log each other out).
  if (!creating) {
    creating = import('@supabase/supabase-js').then(({ createClient }) => {
      client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kopor-auth' } });
      clientKey = key;
      return client;
    }).finally(() => { creating = null; });
  }
  return creating;
}

/** A client with no sign-in at all, for things anyone may send (problem reports), so a stale sign-in can never block them. */
export async function getAnonSupabase(): Promise<SupabaseClient | null> {
  const cfg = await getCloudConfig();
  if (!cfg) return null;
  if (!anon) {
    const { createClient } = await import('@supabase/supabase-js');
    anon = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'kopor-anon' } });
  }
  return anon;
}

/** Call a server function. Its own error message (e.g. "errx.proNotReady") is passed on, not "non-2xx status code". */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const server = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(server?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
