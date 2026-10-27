// Prove the account's phone number with a 6-digit code by text message (free: sent from Kopor's own Android phone
// through SMS Gateway for Android, github.com/capcom6/android-sms-gateway). The number is always the one the
// account signed up with, never one the phone sends, so nobody can "verify" someone else's number.
//   { action: 'status' }        -> { available, verified }
//   { action: 'send' }          -> texts a new code (at most 3 an hour and 5 a day)
//   { action: 'check', code }   -> { verified } (5 wrong tries end the code)
// Secrets: SMS_GATEWAY_USER, SMS_GATEWAY_PASS (from the app's Cloud server screen), optional SMS_GATEWAY_URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { admin, cors, env, HttpError, json } from '../_shared/util.ts';

const CODE_MINUTES = 10, MAX_TRIES = 5, PER_HOUR = 3, PER_DAY = 5;
const available = () => !!Deno.env.get('SMS_GATEWAY_USER') && !!Deno.env.get('SMS_GATEWAY_PASS');

async function hash(code: string, userId: string) {
  const pepper = Deno.env.get('KOPOR_PIN_PEPPER') ?? '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pepper}:${userId}:${code}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare two hex strings without leaking where they differ. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function sendSms(phone: string, text: string) {
  const url = Deno.env.get('SMS_GATEWAY_URL') ?? 'https://api.sms-gate.app/3rdparty/v1/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${env('SMS_GATEWAY_USER')}:${env('SMS_GATEWAY_PASS')}`)}` },
    body: JSON.stringify({ textMessage: { text }, phoneNumbers: [phone], ttl: CODE_MINUTES * 60 }),
  });
  if (!res.ok) { console.error('sms gateway', res.status, (await res.text().catch(() => '')).slice(0, 200)); throw new HttpError(502, 'Could not send the text message. Try again in a few minutes.'); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: u } = await user.auth.getUser();
    if (!u.user) throw new HttpError(401, 'errx.signIn');
    const digits = u.user.email?.match(/^p(\d{10,15})@phone\.kopor\.app$/)?.[1];
    if (!digits) throw new HttpError(400, 'This account has no phone number');
    const phone = `+${digits}`;
    const db = admin();
    const { data: row } = await db.from('phone_checks').select('*').eq('user_id', u.user.id).maybeSingle();
    const verified = !!row?.verified_at && row.verified_phone === digits;

    switch (body.action) {
      case 'status':
        return json({ available: available(), verified });
      case 'send': {
        if (verified) return json({ verified: true });
        if (!available()) throw new HttpError(503, 'Phone check is not switched on yet');
        const now = new Date(), day = now.toISOString().slice(0, 10);
        const sentToday = row?.sent_day === day ? row.sent_today : 0;
        const hourOpen = !!row?.hour_start && now.getTime() - new Date(row.hour_start).getTime() < 3_600_000;
        const sentHour = hourOpen ? row!.sent_hour : 0;
        if (sentToday >= PER_DAY) throw new HttpError(429, 'Too many codes today. Try again tomorrow.');
        if (sentHour >= PER_HOUR) throw new HttpError(429, 'Too many codes. Try again in an hour.');
        if (row?.last_sent && now.getTime() - new Date(row.last_sent).getTime() < 60_000) throw new HttpError(429, 'Wait a minute before asking for another code.');
        const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
        await sendSms(phone, `Kopor code: ${code}. It works for ${CODE_MINUTES} minutes. Never share it: Kopor will never ask you for it.`);
        const { error } = await db.from('phone_checks').upsert({
          user_id: u.user.id, code_hash: await hash(code, u.user.id), expires_at: new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString(),
          attempts: 0, sent_today: sentToday + 1, sent_day: day, last_sent: now.toISOString(),
          hour_start: hourOpen ? row!.hour_start : now.toISOString(), sent_hour: sentHour + 1,
        });
        if (error) throw new Error(error.message);
        return json({ sent: true, to: `${phone.slice(0, 6)}***${phone.slice(-3)}` });
      }
      case 'check': {
        if (verified) return json({ verified: true });
        const code = String(body.code ?? '').replace(/\D/g, '');
        if (!row?.code_hash || !row.expires_at || new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(400, 'The code has expired. Ask for a new one.');
        if (row.attempts >= MAX_TRIES) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.');
        if (code.length !== 6 || !same(await hash(code, u.user.id), row.code_hash)) {
          await db.from('phone_checks').update({ attempts: row.attempts + 1 }).eq('user_id', u.user.id);
          throw new HttpError(400, 'Wrong code');
        }
        const { error } = await db.from('phone_checks').update({ verified_at: new Date().toISOString(), verified_phone: digits, code_hash: null, expires_at: null }).eq('user_id', u.user.id);
        if (error) throw new Error(error.message);
        return json({ verified: true });
      }
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, e instanceof HttpError ? e.status : 500);
  }
});
