// Public price list (supabase/migrations/0035): a secret link customers open to see the real prices.
import { getSupabase } from './supabase';

export interface CatalogItem { name: string; unit: string; price: number; pack_name: string | null; pack_size: number | null; pack_price: number | null; in_stock: boolean }
export interface Catalog { name: string; phone: string; address: string; momo: string; currency: string; products: CatalogItem[] }

const sb = async () => { const s = await getSupabase(); if (!s) throw new Error('err.noCloud'); return s; };

/** The price list link's secret (made the first time; renew = a new link, the old one stops working). */
export async function catalogToken(orgId: string, renew = false): Promise<string> {
  const { data, error } = await (await sb()).rpc('kopor_catalog_token', { o: orgId, renew });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function openCatalog(token: string): Promise<Catalog | null> {
  const { data, error } = await (await sb()).rpc('public_catalog', { token }).abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error(error.message);
  return (data as Catalog | null) ?? null;
}
