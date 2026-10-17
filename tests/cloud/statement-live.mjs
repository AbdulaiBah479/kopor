// LIVE check: the statement-link function exists on the server and refuses unknown tokens.
import { client } from './_auth.mjs';
const sb = client();
const bad = await sb.rpc('public_statement', { token: 'stmt_not_a_real_token_123' });
const short = await sb.rpc('public_statement', { token: 'x' });
const ok = !bad.error && bad.data === null && !short.error && short.data === null;
console.log(ok ? '✓ statement links live: unknown and short tokens show nothing' : `✗ ${JSON.stringify(bad.error ?? bad.data)}`);
process.exit(ok ? 0 : 1);
