import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { dollarRate, productName } from '@/lib/freeApis';

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => vi.unstubAllGlobals());

describe('Open Food Facts barcode names', () => {
  it('builds a clear name from brand, name and size', async () => {
    vi.stubGlobal('fetch', reply({ status: 1, product: { product_name: 'Mi Goreng Original', brands: 'Indomie, Indofood', quantity: '85 g' } }));
    expect(await productName('089686010947')).toBe('Indomie Mi Goreng Original 85 g');
  });
  it('gives nothing for unknown products, bad codes or no internet', async () => {
    vi.stubGlobal('fetch', reply({ status: 0 }));
    expect(await productName('089686120707')).toBeNull();
    expect(await productName('12')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await productName('089686010947')).toBeNull();
  });
});

describe('dollar rate', () => {
  it('reads the Leone rate, keeps it, and shows the saved one when offline', async () => {
    vi.stubGlobal('fetch', reply({ result: 'success', rates: { SLE: 23.04 }, time_last_update_utc: 'Tue, 10 Nov 2026' }));
    expect(await dollarRate()).toMatchObject({ rate: 23.04, fresh: true });
    const offline = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', offline);
    expect(await dollarRate()).toMatchObject({ rate: 23.04, fresh: true });   // still within 12 hours: no new request
    expect(offline).not.toHaveBeenCalled();
  });
  it('gives nothing when it never had a rate and is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await dollarRate()).toBeNull();
  });
});
