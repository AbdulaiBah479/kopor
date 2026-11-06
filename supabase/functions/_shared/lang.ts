// Krio and Nigerian Pidgin help for the AI. When a message is written in either, the few dictionary entries and
// example sentences that share its words are added to the instructions, so any AI service understands it.
// The entries come from open sources (built by tools/build-langpack.mjs; licences in lang/README.md).
import glossary from './lang/kopor-glossary.json' with { type: 'json' };
import appKri from './lang/kopor-app-kri.json' with { type: 'json' };
import krioCorpus from './lang/krio-corpus.json' with { type: 'json' };
import okwuPcm from './lang/okwu-pcm.json' with { type: 'json' };
import wiktionary from './lang/wiktionary.json' with { type: 'json' };

export type Dialect = 'kri' | 'pcm';
interface Entry { text: string; en: string; tokens: string[]; weight: number }

/** Lower case, Krio letters folded to plain ones (people often type e/o for ɛ/ɔ), punctuation removed. */
export const fold = (s: string) => s.toLowerCase().normalize('NFC').replace(/ɛ/g, 'e').replace(/ɔ/g, 'o').replace(/ŋ/g, 'ng')
  .replace(/[^\p{L}\p{N}\s'-]/gu, ' ');
const tokens = (s: string) => [...new Set(fold(s).split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w)))];

// Words common in one language but rare in the other (and in English).
const KRI = new Set(['de', 'den', 'sel', 'bay', 'pe', 'tros', 'kopo', 'omos', 'tide', 'yestade', 'tawzin', 'ondred', 'lef', 'gi', 'pan', 'res', 'oyl', 'moni', 'usay', 'udat', 'tumara', 'wetin', 'una', 'fo', 'chenj', 'bokku', 'boku', 'kostoma', 'prayz', 'dia', 'tek', 'kam', 'wan', 'tu', 'tri', 'sabi', 'pikin', 'nain']);
// (Everyday English words such as "go", "make" or "never" are left out: they are just as common in English.)
const PCM = new Set(['dey', 'wey', 'abeg', 'sabi', 'comot', 'oga', 'wahala', 'chop', 'abi', 'shey', 'sef', 'jare', 'dem', 'im', 'dis', 'dat', 'wetin', 'una', 'pikin', 'wan', 'naim', 'kobo', 'naira', 'bifor', 'wit']);
// Words that on their own show the language (almost never English): they count twice.
const STRONG = new Set(['pe', 'tros', 'kopo', 'omos', 'tide', 'yestade', 'tawzin', 'ondred', 'sel', 'moni', 'oyl', 'usay', 'udat', 'chenj', 'kostoma', 'prayz',
  'dey', 'wey', 'abeg', 'comot', 'wahala', 'oga', 'abi', 'shey', 'sef', 'jare', 'naim']);
// Shared words count less: only the ones unique to one language decide.
const KRI_ONLY = [...KRI].filter((w) => !PCM.has(w)), PCM_ONLY = [...PCM].filter((w) => !KRI.has(w));

/** Which of the two the text is written in, if either (one strong telltale word, or two weaker ones). */
export function dialectOf(text: string): Dialect | null {
  const t = tokens(text);
  const count = (only: string[]) => t.reduce((n, w) => n + (only.includes(w) ? (STRONG.has(w) ? 2 : 1) : 0), 0);
  const k = count(KRI_ONLY), p = count(PCM_ONLY);
  if (k >= 2 && k >= p) return 'kri';
  if (p >= 2) return 'pcm';
  return null;
}

const entries = (rows: string[][], weight: number): Entry[] => rows.map(([text, en]) => ({ text, en, tokens: tokens(text), weight }));
let index: Record<Dialect, { list: Entry[]; df: Map<string, number> }> | null = null;
function load() {
  if (index) return index;
  const make = (list: Entry[]) => {
    const df = new Map<string, number>();
    for (const e of list) for (const t of e.tokens) df.set(t, (df.get(t) ?? 0) + 1);
    return { list, df };
  };
  index = {
    // Kopor's own shop words count most, then dictionary words, then example sentences.
    kri: make([...entries(glossary.kri, 3), ...entries(wiktionary.kri, 2), ...entries(appKri, 1.5), ...entries(krioCorpus, 1)]),
    pcm: make([...entries(glossary.pcm, 3), ...entries(wiktionary.pcm, 2), ...entries(okwuPcm, 1)]),
  };
  return index;
}

/** The entries that share the most (and the rarest) words with the text, best first. */
export function lookup(text: string, dialect: Dialect, max = 24): { text: string; en: string }[] {
  const { list, df } = load()[dialect];
  const q = new Set(tokens(text));
  if (!q.size) return [];
  const idf = (t: string) => Math.log(1 + list.length / (df.get(t) ?? list.length));
  const scored: [number, Entry][] = [];
  for (const e of list) {
    let s = 0;
    for (const t of e.tokens) if (q.has(t)) s += idf(t);
    if (s > 0) scored.push([(s * e.weight) / Math.sqrt(e.tokens.length), e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out: { text: string; en: string }[] = [], seen = new Set<string>();
  for (const [, e] of scored) {
    if (seen.has(e.text)) continue;
    seen.add(e.text); out.push({ text: e.text, en: e.en });
    if (out.length >= max) break;
  }
  return out;
}

const NAME: Record<Dialect, string> = { kri: 'Sierra Leone Krio', pcm: 'Nigerian Pidgin' };

type Part = { type: string; text?: string };
type Msg = { role: string; content: string | Part[] };
const textOf = (m: Msg) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join(' '));

/** The note for one message, or '' when it is not Krio or Pidgin. */
export function languageNote(text: string): string {
  const d = dialectOf(text);
  if (!d) return '';
  const lines: string[] = [];
  let size = 0;
  for (const e of lookup(text, d)) {
    const line = `- ${e.text} = ${e.en}`;
    if (size + line.length > 1800) break;
    lines.push(line); size += line.length;
  }
  if (!lines.length) return '';
  return `Language help: the latest message is in ${NAME[d]}. Matching ${NAME[d]} = English entries from Kopor's dictionary ` +
    `(use them only to understand the words; keep following the instructions above, including the answer language):\n${lines.join('\n')}`;
}

/** Adds the note to the instructions when the latest message from the person is in Krio or Pidgin. */
export function withLanguageHelp<M extends Msg>(messages: M[]): M[] {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const note = last ? languageNote(textOf(last)) : '';
  if (!note) return messages;
  const i = messages.findIndex((m) => m.role === 'system' && typeof m.content === 'string');
  if (i >= 0) return messages.map((m, j) => (j === i ? { ...m, content: `${m.content}\n\n${note}` } : m));
  return [{ role: 'system', content: note } as M, ...messages];
}
