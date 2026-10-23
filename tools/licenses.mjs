// After `vite build`: write dist/licenses.txt, the notices of every open-source package shipped in the app
// (their licences, e.g. MIT and Apache-2.0, require the copyright notice to travel with the software).
// Kopor itself is not open source; see LICENSE.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const shipped = Object.entries(lock.packages ?? {})
  .filter(([path, p]) => path.startsWith('node_modules/') && !p.dev && !p.devOptional && !path.includes('/node_modules/@types/'))
  .map(([path, p]) => ({ path, name: path.split('node_modules/').pop(), version: p.version, license: p.license }));

const seen = new Set();
const blocks = [];
for (const pkg of shipped.sort((a, b) => a.name.localeCompare(b.name))) {
  const id = `${pkg.name}@${pkg.version}`;
  if (seen.has(id) || !existsSync(pkg.path)) continue;
  seen.add(id);
  const file = readdirSync(pkg.path).find((f) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f));
  const text = file ? readFileSync(join(pkg.path, file), 'utf8').trim() : '';
  const meta = JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'));
  const license = pkg.license ?? meta.license ?? (typeof meta.licenses?.[0] === 'object' ? meta.licenses[0].type : 'see package');
  blocks.push(`${id}  (${license})${meta.homepage ? `\n${meta.homepage}` : ''}${text ? `\n\n${text}` : ''}`);
}

const head = `Kopor — open-source licences

Kopor is © ${new Date().getFullYear() > 2026 ? `2026–${new Date().getFullYear()}` : 2026} Abdulai Bah. All rights reserved. Kopor itself is NOT open source.
It is built with the open-source packages below, which belong to their authors and are used under their licences.
Also used on Kopor's servers: Supabase, Meta Omnilingual ASR (Apache-2.0), Tesseract OCR data (Apache-2.0).

${blocks.length} packages
`;
writeFileSync('dist/licenses.txt', [head, ...blocks].join(`\n\n${'='.repeat(80)}\n\n`) + '\n');
console.log(`licenses.txt: ${blocks.length} open-source packages`);
