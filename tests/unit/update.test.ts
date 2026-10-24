import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { checkForUpdate, readRelease, skipUpdate } from '@/features/appUpdate';

const release = {
  body: "Android test build 52 of Kopor (2026-10-24). Install kopor-test.apk.\n\nWhat's new:\n- Staff attendance and salaries\n- Import customers and stock\n\n<!-- kopor-build-sha: abc -->",
  assets: [{ name: 'kopor-test.apk' }, { name: 'kopor-test-50.apk' }, { name: 'kopor-test-52.apk' }, { name: 'kopor-test-9.apk' }],
};

describe('"New version available" for the Android test app', () => {
  beforeEach(async () => {
    await db.delete(); await db.open();
    vi.stubEnv('VITE_APP_BUILD', '50');
    (globalThis as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true };
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete (globalThis as unknown as { Capacitor?: unknown }).Capacitor; });

  it('reads the newest build number and the What’s new lines', () => {
    expect(readRelease(release)).toEqual({ build: 52, notes: ['Staff attendance and salaries', 'Import customers and stock'] });
    expect(readRelease({ body: '', assets: [{ name: 'kopor-test.apk' }] })).toBeNull();
  });

  it('offers a newer build, asks GitHub at most once a day, and Later hides that build', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(release), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Date.now();
    expect((await checkForUpdate(now))?.build).toBe(52);
    expect((await checkForUpdate(now + 1000))?.build).toBe(52);
    expect(fetchMock).toHaveBeenCalledTimes(1);                       // remembered for the day
    await skipUpdate(52);
    expect(await checkForUpdate(now + 2000)).toBeNull();
  });

  it('says nothing when this phone already has the newest build, or in the web app', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(release), { status: 200 })));
    vi.stubEnv('VITE_APP_BUILD', '52');
    expect(await checkForUpdate()).toBeNull();
    vi.stubEnv('VITE_APP_BUILD', '50');
    delete (globalThis as unknown as { Capacitor?: unknown }).Capacitor;
    expect(await checkForUpdate()).toBeNull();
  });
});
