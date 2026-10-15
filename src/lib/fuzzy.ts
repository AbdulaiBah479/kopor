// Forgiving name matching for voice and typed entries: "Aminatta", "aminata", "Aminata Sesay" and "Aminatu" all find
// the customer "Aminata Sesay"; "rais" finds "Rice 50kg bag". Krio letters fold to plain ones (ɛ→e, ɔ→o).

export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ɛ/g, 'e').replace(/ɔ/g, 'o').replace(/ŋ/g, 'ng').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** How many typing/hearing mistakes a word of this length may have and still count as the same word. */
const allowed = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : len <= 8 ? 2 : 3);

/** Similarity of one heard word to a candidate word (1 = same, 0 = no match). Vowel-insensitive as a tie-breaker. */
function wordScore(heard: string, word: string): number {
  if (!heard || !word) return 0;
  if (heard === word) return 1;
  if (word.length >= 4 && (heard.startsWith(word) || word.startsWith(heard)) && Math.min(heard.length, word.length) >= 4) return 0.9;
  const d = distance(heard, word), len = Math.max(heard.length, word.length);
  // Same first letter: one more slip allowed (Krio spellings like "shuga" for sugar, "rɛs" for rice).
  const extra = len >= 5 && heard[0] === word[0] ? 1 : 0;
  if (d <= allowed(len) + extra) return Math.max(0.6, 1 - d / len);
  const consonants = (s: string) => s.replace(/[aeiouy]/g, '');
  const c1 = consonants(heard), c2 = consonants(word);
  return c1.length >= 3 && c1 === c2 ? 0.6 : 0;
}

/**
 * Best candidate (customer or product name) mentioned anywhere in `text`, or undefined.
 * Every word of the text is compared with every word (3+ letters) of each candidate.
 */
export function bestMatch(text: string, candidates: string[], minScore = 0.6): string | undefined {
  const heard = fold(text).split(' ').filter((w) => w.length >= 3);
  let best: { name: string; score: number } | undefined;
  for (const name of candidates) {
    const words = fold(name).split(' ').filter((w) => w.length >= 3 && !/^\d/.test(w));
    if (!words.length) continue;
    let score = 0;
    for (const w of words) for (const h of heard) score = Math.max(score, wordScore(h, w));
    // A full multi-word name heard in order is a stronger match than one of its words.
    if (words.length > 1 && fold(text).includes(words.join(' '))) score = Math.max(score, 1.05);
    if (score >= minScore && (!best || score > best.score)) best = { name, score };
  }
  return best?.name;
}
