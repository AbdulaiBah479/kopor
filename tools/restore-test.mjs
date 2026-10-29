// Restore test: load a decrypted nightly backup into an empty copy of the Kopor database (embedded Postgres, the
// real migrations) and check that every row of every table comes back. A backup is only useful if it restores.
// Run: node tools/restore-test.mjs <folder with public.<table>.jsonl files>
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) { console.error('Usage: node tools/restore-test.mjs <backup folder>'); process.exit(2); }

const db = new PGlite();
// The parts of Supabase the migrations expect.
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz,
    raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text, banned_until timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
`);
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
// Restore the data exactly as it was: no triggers or checks between tables while loading.
await db.exec('set session_replication_role = replica');

const lines = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
const load = async (table, file) => {
  const rows = lines(file);
  if (!rows.length) return 0;
  // Only the columns the backup has: a backup taken before a newer migration lacks its new columns, which then
  // get their defaults instead of failing.
  const [schema, name] = table.replace(/"/g, '').split('.');
  const known = new Set((await db.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, name])).rows.map((r) => r.column_name));
  const cols = Object.keys(JSON.parse(rows[0])).filter((c) => known.has(c)).map((c) => `"${c}"`).join(', ');
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = `[${rows.slice(i, i + 500).join(',')}]`;
    await db.query(`insert into ${table} (${cols}) overriding system value select ${cols} from json_populate_recordset(null::${table}, $1::json)`, [chunk]);
  }
  return rows.length;
};

let problems = 0, total = 0;
if (existsSync(join(dir, 'auth.users.jsonl'))) {
  const n = await load('auth.users', join(dir, 'auth.users.jsonl'));
  console.log(`auth.users: ${n} restored`);
}
for (const f of readdirSync(dir).filter((x) => /^public\..+\.jsonl$/.test(x)).sort()) {
  const table = f.replace(/^public\.|\.jsonl$/g, '');
  const exists = (await db.query(`select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table])).rows.length;
  if (!exists) { console.log(`::warning::${table}: in the backup but not in the migrations (skipped)`); continue; }
  try {
    const want = await load(`public."${table}"`, join(dir, f));
    const got = (await db.query(`select count(*)::int as c from public."${table}"`)).rows[0].c;
    total += got;
    if (got !== want) { problems++; console.log(`::error::${table}: ${want} in the backup, ${got} restored`); }
    else console.log(`${table}: ${got} restored`);
  } catch (e) { problems++; console.log(`::error::${table}: could not be restored: ${e.message}`); }
}
console.log(problems ? `\nRestore test FAILED: ${problems} table(s) did not restore` : `\nRestore test passed: ${total} rows restored into a fresh database`);
process.exit(problems ? 1 : 0);
