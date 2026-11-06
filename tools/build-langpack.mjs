// Builds Kopor's Krio and Nigerian Pidgin language pack (supabase/functions/_shared/lang/) from open sources whose
// licences allow commercial use. The AI is shown the few entries that match each message (see _shared/lang.ts).
//   node tools/build-langpack.mjs            (downloads the sources once into the system temp folder)
// Sources and licences: supabase/functions/_shared/lang/README.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const OUT = 'supabase/functions/_shared/lang';
const CACHE = path.join(os.tmpdir(), 'kopor-langdata');
fs.mkdirSync(CACHE, { recursive: true });
const UA = { 'User-Agent': 'KoporLangPack/1.0 (https://github.com/AbdulaiBah479/kopor)' };

async function cached(name, url, as = 'text') {
  const f = path.join(CACHE, name);
  if (!fs.existsSync(f)) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.writeFileSync(f, await r.text());
  }
  const s = fs.readFileSync(f, 'utf8');
  return as === 'json' ? JSON.parse(s) : s;
}

const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const words = (s) => tidy(s).split(' ').filter(Boolean).length;

/** Minimal CSV reader (quoted fields, doubled quotes). */
function csv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// Shop and money sentences first: they matter most to Kopor's users.
const SHOP = /\b(money|pay|paid|buy|bought|sell|sold|price|cost|owe|debt|credit|shop|market|customer|change|cash|bank|account|profit|loss|goods|stock|rice|oil|sugar|bag|carton|dozen|cheap|expensive|discount|receipt|transfer|send|sent|collect|borrow|lend|salary|work|business|trader|sale|count|hundred|thousand|million|today|yesterday|tomorrow)\b/i;
// A Pidgin sentence has at least one everyday Pidgin word (some rows of the source are plain English).
const PIDGIN = /\b(dey|don|wey|dem|una|sabi|fit|pikin|wetin|abeg|comot|chop|bin|sef|oga|wahala|na|no be|am|im|dis|dat|de|tok|waka|bifor|wit|wan|make|carry|sey|say|abi|shey|jare)\b/i;

async function pidgin() {
  const rows = csv(await cached('pcm-eng.csv', 'https://huggingface.co/datasets/Okwu/african-language-parallel-corpus/resolve/main/data/pcm-eng/pcm-eng.csv'));
  const seen = new Set(), out = [];
  for (const r of rows) {
    const p = tidy(r.source_text), e = tidy(r.english_translation);
    if (r.verified !== 'true' || !p || !e || p.toLowerCase() === e.toLowerCase()) continue;
    const n = words(p), ratio = e.length / p.length;
    if (n < 2 || n > 16 || ratio < 0.4 || ratio > 2.5 || !PIDGIN.test(p)) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push([p, e]);
  }
  const shop = out.filter(([, e]) => SHOP.test(e)), rest = out.filter(([, e]) => !SHOP.test(e));
  return [...shop, ...rest].slice(0, 12_000);
}

async function krioStories() {
  const j = await cached('krio-corpus.json', 'https://datasets-server.huggingface.co/rows?dataset=Jaward/Krio-Corpus&config=default&split=train&offset=0&length=100', 'json');
  const out = [];
  for (const { row } of j.rows) {
    const k = row.story_kri.split('\n').map(tidy).filter(Boolean), e = row.story_eng.split('\n').map(tidy).filter(Boolean);
    if (k.length !== e.length) continue; // only stories whose lines match one to one
    k.forEach((s, i) => { if (words(s) >= 2 && words(s) <= 30) out.push([s, e[i]]); });
  }
  return out;
}

/** Wiktionary entries for one language: [word, first meanings]. */
async function wiktionary(cat, section) {
  const api = (q) => fetch('https://en.wiktionary.org/w/api.php?format=json&formatversion=2&' + q, { headers: UA }).then((r) => r.json());
  const file = path.join(CACHE, `wikt-${cat}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const titles = (await api(`action=query&list=categorymembers&cmtitle=Category:${cat}&cmlimit=500`)).query.categorymembers.map((m) => m.title);
  const clean = (s) => s.replace(/\{\{(?:l|m|w|lb|gloss|q|qualifier|i)\|[^|}]*\|([^|}]*)[^}]*\}\}/g, '$1').replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const j = await api('action=query&prop=revisions&rvprop=content&rvslots=main&titles=' + encodeURIComponent(titles.slice(i, i + 40).join('|')));
    for (const p of j.query.pages) {
      const sec = (p.revisions?.[0]?.slots?.main?.content ?? '').split(/\n==(?!=)/).find((s) => s.startsWith(section + '=='));
      const defs = (sec ?? '').split('\n').filter((l) => /^#\s/.test(l)).map((l) => clean(l.slice(1))).filter(Boolean).slice(0, 3);
      if (defs.length) out.push([p.title, defs.join('; ').slice(0, 160)]);
    }
  }
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

/** Kopor's own Krio screen text, paired with the English (placeholders and long help texts left out). */
async function appKrio() {
  const load = async (lang) => {
    const r = await build({ entryPoints: [`src/i18n/${lang}.ts`], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
    return (await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'))).default;
  };
  const [en, kri] = await Promise.all([load('en'), load('kri')]);
  const out = [], seen = new Set();
  const walk = (a, b) => {
    for (const k of Object.keys(b ?? {})) {
      if (typeof b[k] === 'object') walk(a?.[k], b[k]);
      else if (typeof b[k] === 'string' && typeof a?.[k] === 'string') {
        const s = tidy(b[k]), e = tidy(a[k]);
        if (s === e || /\{\{|<|https?:/.test(s) || words(s) < 2 || words(s) > 20 || seen.has(s)) continue;
        seen.add(s); out.push([s, e]);
      }
    }
  };
  walk(en, kri);
  return out;
}

const glossary = JSON.parse(fs.readFileSync(`${OUT}/kopor-glossary.json`, 'utf8'));
const [pcm, stories, app, wKri, wPcm] = await Promise.all([pidgin(), krioStories(), appKrio(), wiktionary('Krio_lemmas', 'Krio'), wiktionary('Nigerian_Pidgin_lemmas', 'Nigerian Pidgin')]);

// One file per licence, so each keeps its own terms (see README.md).
const write = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data).replace(/\],\[/g, '],\n['));
write('okwu-pcm.json', pcm);
write('krio-corpus.json', stories);
write('kopor-app-kri.json', app);
write('wiktionary.json', { kri: wKri, pcm: wPcm });
console.log(`Kopor glossary: Krio ${glossary.kri.length}, Pidgin ${glossary.pcm.length}`);
console.log(`Okwu Pidgin pairs: ${pcm.length} (shop/money first)`);
console.log(`Krio-Corpus lines: ${stories.length}`);
console.log(`Kopor app Krio text: ${app.length}`);
console.log(`Wiktionary: Krio ${wKri.length}, Pidgin ${wPcm.length}`);
