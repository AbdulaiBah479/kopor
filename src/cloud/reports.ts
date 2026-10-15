// Problem reports and complaints (supabase/migrations/0011_reports.sql). Sent straight to the Kopor cloud, where only
// the app owner can read them (Owner dashboard). Offline or failing: kept on this phone and sent later.
import { getSupabase } from './supabase';

export type ReportKind = 'bug' | 'money' | 'payment' | 'account' | 'abuse' | 'suggestion' | 'other';
export const REPORT_KINDS: ReportKind[] = ['bug', 'money', 'payment', 'account', 'abuse', 'suggestion', 'other'];
export interface ReportInput { kind: ReportKind; message: string; contact?: string; about?: string; orgId?: string | null }

const QUEUE = 'kopor-report-queue';
type Queued = ReportInput & { app_info: Record<string, unknown> };

/** Technical context that helps fix a problem. Never includes business records, names or numbers. */
export function appInfo(extra: Record<string, unknown> = {}) {
  const standalone = matchMedia?.('(display-mode: standalone)').matches;
  return {
    version: import.meta.env.VITE_APP_VERSION ?? 'web', screen: location.hash.replace(/\/(i|pay)\/[^/]+/, '/$1/…').slice(0, 60),
    lang: document.documentElement.lang, theme: document.documentElement.dataset.theme, size: `${innerWidth}x${innerHeight}`,
    online: navigator.onLine, installed: !!standalone, ua: navigator.userAgent.slice(0, 160), at: new Date().toISOString(), ...extra,
  };
}

const readQueue = (): Queued[] => { try { return JSON.parse(localStorage.getItem(QUEUE) ?? '[]'); } catch { return []; } };
const writeQueue = (q: Queued[]) => { try { localStorage.setItem(QUEUE, JSON.stringify(q.slice(-20))); } catch { /* storage full or blocked */ } };

async function insert(r: Queued) {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { error } = await sb.from('reports').insert({
    kind: r.kind, message: r.message.trim().slice(0, 4000), contact: (r.contact ?? '').trim().slice(0, 120),
    about: (r.about ?? '').trim().slice(0, 200), org_id: r.orgId ?? null, app_info: r.app_info,
  });
  if (error) throw new Error(error.message);
}

/** Send a report. Returns 'sent', or 'queued' when it will be sent automatically once the phone is back online. */
export async function sendReport(input: ReportInput, extraInfo: Record<string, unknown> = {}): Promise<'sent' | 'queued'> {
  const r: Queued = { ...input, app_info: appInfo(extraInfo) };
  try { await insert(r); return 'sent'; } catch { writeQueue([...readQueue(), r]); return 'queued'; }
}

/** Retry reports kept on this phone (called at start-up and when the connection comes back). */
export async function flushReports() {
  const q = readQueue();
  if (!q.length || !navigator.onLine) return;
  const left: Queued[] = [];
  for (const r of q) { try { await insert(r); } catch { left.push(r); } }
  writeQueue(left);
}

/** Automatic crash report (used when no Sentry account is configured): at most 5 a day per phone, each message once. */
export async function autoCrashReport(error: unknown) {
  try {
    const msg = (error instanceof Error ? `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(0, 6).join('\n')}` : String(error)).slice(0, 1500);
    if (/Failed to fetch|NetworkError|Load failed|errx?\.|chunk/i.test(msg)) return; // connection problems are not bugs
    const day = new Date().toISOString().slice(0, 10);
    const key = 'kopor-crash-' + day;
    const seen: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    const sig = msg.split('\n')[0].slice(0, 120);
    if (seen.length >= 5 || seen.includes(sig)) return;
    localStorage.setItem(key, JSON.stringify([...seen, sig]));
    await sendReport({ kind: 'bug', message: `Automatic crash report\n${msg}` }, { automatic: true });
  } catch { /* reporting must never cause another error */ }
}
