// The shop's own phone as its SMS sender (SMS Gateway for Android, free cloud relay at api.sms-gate.app).
import { admin, HttpError, unseal } from './util.ts';

const API = 'https://api.sms-gate.app/3rdparty/v1';
export interface Gate { user: string; pass: string }

export async function gateFor(orgId: string): Promise<(Gate & { auto: boolean; bal: boolean; limit: number; sign: string; token: string }) | null> {
  const { data } = await admin().from('org_secrets').select('sms_user, sms_pass_enc, sms_sign_enc, sms_hook_token, sms_auto, sms_bal, sms_daily_limit').eq('org_id', orgId).maybeSingle();
  if (!data?.sms_user || !data.sms_pass_enc) return null;
  return {
    user: data.sms_user, pass: await unseal(data.sms_pass_enc), sign: data.sms_sign_enc ? await unseal(data.sms_sign_enc) : '',
    token: data.sms_hook_token ?? '', auto: !!data.sms_auto, bal: data.sms_bal !== false, limit: data.sms_daily_limit ?? 20,
  };
}

export async function gate(g: Gate, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Basic ${btoa(`${g.user}:${g.pass}`)}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new HttpError(400, 'The phone app login is wrong. Check the username and password in SMS Gateway → Cloud server.');
  if (!res.ok) throw new HttpError(502, `The phone could not be reached (${res.status}). Is SMS Gateway open and online?`);
  return res.json().catch(() => ({}));
}

/** Send one text from the shop's phone. */
export const sendText = (g: Gate, to: string, text: string) =>
  gate(g, 'POST', '/messages', { textMessage: { text: text.slice(0, 450) }, phoneNumbers: [to], ttl: 6 * 3600 });

/** How many texts this business sent today (all kinds), to respect its daily limit. */
export async function sentToday(orgId: string): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await admin().from('sms_log').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('at', since.toISOString());
  return count ?? 0;
}

export { leones, sameHex, signature } from "./smsSign.ts";
