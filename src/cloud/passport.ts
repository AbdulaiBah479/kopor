// Credit Passport: a frozen, server-made record of the business for lenders (supabase/migrations/0027_passport.sql).
import { getSupabase } from './supabase';

export interface PassportMonth { month: string; sales: number; expenses: number; days: number; records: number }
export interface PassportData {
  business: { name: string; type: string; owner_name: string; phone: string; address: string };
  since: string | null; months: PassportMonth[];
  sales_6m: number; expenses_6m: number; active_days_6m: number; records_6m: number;
  credit_given_6m: number; credit_repaid_6m: number; customers_owe_now: number; customers: number;
  monime_confirmed_6m: number; staff: number; branches: number;
}
export interface Passport { id: string; data: PassportData; created_at: string; expires_at: string }
export interface PassportRow { id: string; token: string; created_at: string; expires_at: string; revoked: boolean }

const sb = async () => { const s = await getSupabase(); if (!s) throw new Error('err.noCloud'); return s; };

export async function makePassport(orgId: string): Promise<string> {
  const { data, error } = await (await sb()).rpc('kopor_make_passport', { oid: orgId });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function listPassports(orgId: string): Promise<PassportRow[]> {
  const { data, error } = await (await sb()).from('passports').select('id, token, created_at, expires_at, revoked').eq('org_id', orgId).order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return data as PassportRow[];
}
export async function revokePassport(id: string) {
  const { error } = await (await sb()).rpc('kopor_revoke_passport', { pid: id });
  if (error) throw new Error(error.message);
}
export async function openPassport(token: string): Promise<Passport | null> {
  const { data, error } = await (await sb()).rpc('public_passport', { token }).abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error(error.message);
  return (data as Passport | null) ?? null;
}
