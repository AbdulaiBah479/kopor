// Load screen code on demand, surviving flaky mobile networks: retry once, and if a code file is gone
// (an older copy of the app after an update) refresh the page once to fetch the new version.
import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'kopor-chunk-reload';

// Same signature as React.lazy (which also uses `any` for the component's props).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy<T>(async () => {
    try {
      const mod = await factory();
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
      return mod;
    } catch (first) {
      await new Promise((r) => setTimeout(r, 1000));
      try { return await factory(); } catch {
        let reloaded = false;
        try { reloaded = sessionStorage.getItem(RELOAD_KEY) === '1'; sessionStorage.setItem(RELOAD_KEY, '1'); } catch { /* storage unavailable */ }
        if (!reloaded && navigator.onLine) location.reload();
        throw first;
      }
    }
  });
}
