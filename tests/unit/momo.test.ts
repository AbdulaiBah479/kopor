import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as app from '@/lib/momo';
import * as server from '../../supabase/functions/_shared/momo';

describe('Sierra Leone mobile money numbers', () => {
  it('accepts the ways people write a number', () => {
    for (const n of ['076 123 456', '076-123-456', '76123456', '+232 76 123456', '23276123456', '0023276123456'])
      expect(app.normalizeSlPhone(n), n).toBe('+23276123456');
  });
  it('rejects numbers that are not Sierra Leone mobiles', () => {
    for (const n of ['', '12345', '076 123 45', '+44 7700 900123', '076 123 4567']) expect(app.normalizeSlPhone(n), n).toBeNull();
  });
  it('knows the network from the number', () => {
    expect(app.networkOf('076 123 456')).toBe('m17'); // Orange Money
    expect(app.networkOf('088 123 456')).toBe('m18'); // Afrimoney
    expect(app.networkOf('077 123 456')).toBe('m18');
    expect(app.networkOf('031 123 456')).toBeNull();  // not served by Monime: the owner picks
  });
  it('masks a number for display', () => expect(app.maskPhone('+23276123456')).toBe('076 *** 456'));
  it('the app and the server use the same rules', () => {
    for (const n of ['072000111', '+23230111222', '099 888 777', '031 123 456', 'abc']) {
      expect(app.normalizeSlPhone(n)).toBe(server.normalizeSlPhone(n));
      expect(app.networkOf(n)).toBe(server.networkOf(n));
    }
  });
  it('server code has no broken characters (UTF-8 read as Windows-1252)', () => {
    const dir = join(__dirname, '../../supabase/functions');
    const files = ['monime/index.ts', 'monime-webhook/index.ts', 'billing/index.ts', 'push/index.ts', '_shared/monime.ts', '_shared/llm.ts'];
    const bad = files.filter((f) => /Ã[\u0080-¿×—]|â€|â‡|Â[·©®°]|�/.test(readFileSync(join(dir, f), 'utf8')));
    expect(bad).toEqual([]);
  });
});
