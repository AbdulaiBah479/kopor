// Supabase client. Configured from build env (VITE_SUPABASE_*) or at runtime from Settings,
// so a deployed app can be pointed at a project without rebuilding. Without config Kopor runs fully offline.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMeta, setMeta } from '@/db/repo';

export interface CloudConfig { url: string; anonKey: string }
let client: SupabaseClient | null = null;
let clientKey = '';

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
  if (!client || clientKey !== key) {
    // Loaded on demand: offline-only users never download the cloud library.
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kopor-auth' } });
    clientKey = key;
  }
  return client;
}
