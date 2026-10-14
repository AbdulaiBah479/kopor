// LIVE check of the AI proxy's provider chain for a signed-in account. Usage: node tests/cloud/ai-live.mjs <test phone> <pin>
import { client, pinAuth } from './_auth.mjs';

const [phone, pin] = process.argv.slice(2);
const sb = client();
const r = await pinAuth(sb, 'signin', `p232${phone.replace(/^0/, '')}@phone.kopor.app`, pin);
if (!r.ok) { console.log('sign-in failed', r.error); process.exit(1); }
const t0 = Date.now();
const { data, error: e2 } = await sb.functions.invoke('ai', { body: { messages: [
  { role: 'system', content: 'Answer in Sierra Leone Krio, one short sentence.' },
  { role: 'user', content: 'Aw a go mek mɔ prɔfit na mi shɔp?' },
] } });
const body = e2 ? await e2.context?.json?.().catch(() => null) : data;
console.log(`${Date.now() - t0} ms`, JSON.stringify(body).slice(0, 300));
process.exit(body?.content ? 0 : 1);