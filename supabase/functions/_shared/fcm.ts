// Android notifications through Firebase Cloud Messaging (HTTP v1). The server signs in to Google with the Firebase
// service account in the FCM_SERVICE_ACCOUNT secret (never in the code); nothing is sent when it is not set.
interface ServiceAccount { project_id: string; client_email: string; private_key: string }

let cached: { token: string; until: number } | null = null;

function account(): ServiceAccount | null {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  try { const a = JSON.parse(raw); return a.project_id && a.client_email && a.private_key ? a : null; } catch { return null; }
}


const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function accessToken(a: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const der = Uint8Array.from(atob(a.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`FCM sign-in failed (${res.status})`);
  const j = await res.json();
  cached = { token: j.access_token, until: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Send one notification. Returns 'ok', 'gone' (the phone uninstalled or the token expired) or 'failed'. */
export async function sendFcm(token: string, m: { title: string; body: string; url: string; tag: string }): Promise<'ok' | 'gone' | 'failed'> {
  const a = account();
  if (!a) return 'failed';
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${await accessToken(a)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: m.title, body: m.body }, data: { url: m.url },
        android: { priority: 'HIGH', notification: { tag: m.tag } } } }),
    });
    if (res.ok) return 'ok';
    const text = await res.text().catch(() => '');
    return res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(text) ? 'gone' : 'failed';
  } catch { return 'failed'; }
}
