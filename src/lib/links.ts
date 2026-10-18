// Links customers open (invoices, quotations, statements, pay pages) must point to the public website, never to
// where this copy of Kopor is running: inside the Android app that is https://localhost/, which only exists on the phone.
export const APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || 'https://abdulaibah479.github.io/kopor/';
const isNative = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Base address for shared links, ending in "/". */
export function publicBase(): string {
  const env = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  const base = env || (isNative() || location.hostname === 'localhost' ? APP_URL : `${location.origin}${location.pathname}`);
  return base.endsWith('/') ? base : `${base}/`;
}

/** Full link to an in-app public page, e.g. publicLink('/i/abc') -> https://…/#/i/abc */
export const publicLink = (path: string) => `${publicBase()}#${path.startsWith('/') ? path : `/${path}`}`;
