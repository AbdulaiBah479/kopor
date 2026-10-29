// Server side of the bank-style protections (supabase/migrations/0036_protection.sql): two-person approval, the
// phones list, and the tamper-proof history check.
import { getMeta, setMeta } from '@/db/repo';
import { getSupabase } from './supabase';

export type ApprovalKind = 'refund' | 'delete' | 'credit' | 'sale';
export interface ApprovalRequest { kind: ApprovalKind; payload: Record<string, unknown>; amount: number; summary: string }
export interface Approval extends ApprovalRequest { id: number; requested_name: string; status: 'pending' | 'done' | 'rejected'; at: string }
export interface Device { device_id: string; member_name: string; label: string; first_seen: string; last_seen: string; revoked: boolean }

const sb = async () => { const s = await getSupabase(); if (!s) throw new Error('err.noCloud'); return s; };
const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (await sb()).rpc(fn, args).abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error(error.message);
  return data as T;
};

export const requestApproval = (orgId: string, r: ApprovalRequest) => rpc<number>('kopor_request_approval', { o: orgId, k: r.kind, p: r.payload, amt: r.amount, s: r.summary });
export const decideApproval = (id: number, done: boolean) => rpc<void>('kopor_decide_approval', { aid: id, done });
export async function pendingApprovals(orgId: string): Promise<Approval[]> {
  const { data, error } = await (await sb()).from('approvals').select('id, kind, payload, amount, summary, requested_name, status, at')
    .eq('org_id', orgId).eq('status', 'pending').order('at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return data as Approval[];
}

/** This phone's own random id (made once, kept on the phone). */
export async function deviceId(): Promise<string> {
  let id = await getMeta<string>('deviceId', '');
  if (!id) { id = crypto.randomUUID().replace(/-/g, ''); await setMeta('deviceId', id); }
  return id;
}
/** "Android · Chrome"-style name for the phones list (no personal details). */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Other';
  const model = ua.match(/Android [\d.]+; ([^;)]+)/)?.[1]?.replace(/Build.*/, '').trim();
  const app = /; wv\)/.test(ua) ? 'Kopor app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return [os, model && model !== 'K' ? model : '', app].filter(Boolean).join(' · ').slice(0, 80);
}
export const deviceSeen = async (orgId: string) => rpc<'ok' | 'revoked'>('kopor_device_seen', { o: orgId, d: await deviceId(), l: deviceLabel() });
export const revokeDevice = (orgId: string, id: string) => rpc<void>('kopor_device_revoke', { o: orgId, d: id });
export async function listDevices(orgId: string): Promise<Device[]> {
  const { data, error } = await (await sb()).from('devices').select('device_id, member_name, label, first_seen, last_seen, revoked').eq('org_id', orgId).order('last_seen', { ascending: false });
  if (error) throw new Error(error.message);
  return data as Device[];
}

export const verifyHistory = (orgId: string) => rpc<{ ok: boolean; checked: number; broken_at?: number; summary?: string }>('kopor_verify_audit', { o: orgId });
