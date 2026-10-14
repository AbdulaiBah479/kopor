// Every language has every key, and every t('literal.key') used in the code exists.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '@/i18n/en';
import kri from '@/i18n/kri';
import fr from '@/i18n/fr';

const flat = (o: object, p = ''): Record<string, string> =>
  Object.entries(o).reduce((acc, [k, v]) => ({ ...acc, ...(typeof v === 'object' ? flat(v, `${p}${k}.`) : { [`${p}${k}`]: v }) }), {});

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
});

describe('translations', () => {
  const E = flat(en);
  it.each([['kri', flat(kri)], ['fr', flat(fr)]])('%s has the same keys and placeholders as English', (_, D) => {
    expect(Object.keys(D).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) {
      const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
      expect(ph(D[k]), k).toEqual(ph(E[k]));
    }
  });
  it('all literal keys used in the code exist', () => {
    const missing: string[] = [];
    for (const f of files(join(__dirname, '../../src'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z]+\.[a-zA-Z0-9_.]+)'/g)) if (!(m[1] in E)) missing.push(`${m[1]} (${f})`);
      for (const m of src.matchAll(/new AppError\('([a-zA-Z.]+)'/g)) if (!(m[1] in E)) missing.push(`${m[1]} (${f})`);
      for (const m of src.matchAll(/new Error\('(errx?\.[a-zA-Z]+)'/g)) if (!(m[1] in E)) missing.push(`${m[1]} (${f})`);
    }
    expect(missing).toEqual([]);
  });
});
