// Size budget (run after `npm run build`): people pay for mobile data by the megabyte, so the app must stay small.
// Fails when the first load or the offline copy grows past the budget; raise a budget only on purpose.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = { firstLoadKB: 290, offlineCopyKB: 1500 } // raised from 1350 on 2026-10-24 for staff, imports, expiry and tax screens; // first load: gzipped; offline copy: precache, as stored
const html = readFileSync('dist/index.html', 'utf8');
const first = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const firstKB = first.reduce((s, f) => s + gzipSync(readFileSync(`dist/${f}`)).length, 0) / 1024;
const sw = readFileSync('dist/sw.js', 'utf8');
const precached = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
const offlineKB = precached.reduce((s, f) => { try { return s + readFileSync(`dist/${f}`).length; } catch { return s; } }, 0) / 1024;

const problems = [];
if (firstKB > BUDGET.firstLoadKB) problems.push(`first load is ${firstKB.toFixed(1)} KB (budget ${BUDGET.firstLoadKB} KB)`);
if (offlineKB > BUDGET.offlineCopyKB) problems.push(`offline copy is ${offlineKB.toFixed(0)} KB (budget ${BUDGET.offlineCopyKB} KB)`);
const heavy = precached.filter((f) => /tesseract|traineddata|\.wasm/.test(f));
if (heavy.length) problems.push(`heavy optional files must not be precached: ${heavy.join(', ')}`);
console.log(`First load ${firstKB.toFixed(1)} / ${BUDGET.firstLoadKB} KB gzipped · offline copy ${offlineKB.toFixed(0)} / ${BUDGET.offlineCopyKB} KB (${precached.length} files)`);
if (problems.length) { console.error(problems.map((p) => `::error::${p}`).join('\n')); process.exit(1); }
