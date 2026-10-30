// Crash & error reporting with Sentry (free tier). Off unless VITE_SENTRY_DSN is set at build time.
// Privacy: no user identity, no IP/cookies, no URLs with tokens, no business data in reports.
type Capture = (e: unknown) => void;
let capture: Capture | null = null;

export async function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  const Sentry = await import('@sentry/browser');
  Sentry.init({
    dsn,
    // Which build sent it: the Android test build number, or the web app.
    release: `kopor@${import.meta.env.VITE_APP_BUILD ? `android-${import.meta.env.VITE_APP_BUILD}` : import.meta.env.VITE_APP_VERSION ?? 'web'}`,
    environment: import.meta.env.VITE_APP_BUILD ? 'android' : 'web',
    // Sentry v11 collects no personal data by default; beforeSend below scrubs anything left.
    tracesSampleRate: 0,
    // A page from before an update asking for a file the update replaced: handled by reloading (see main.tsx).
    ignoreErrors: [/Failed to fetch dynamically imported module/, /Importing a module script failed/, /error loading dynamically imported module/, /Unable to preload CSS/],
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        if (event.request.url) event.request.url = event.request.url.split('#')[0]; // hash routes can carry invoice tokens
      }
      return event;
    },
    beforeBreadcrumb: (b) => (b.category === 'console' || b.category === 'ui.input' ? null : b),
  });
  capture = (e) => Sentry.captureException(e);
}

/** Sentry when configured; otherwise a throttled automatic bug report to the owner's report inbox. */
export const reportError = (e: unknown) => {
  try {
    if (capture) capture(e);
    else import('@/cloud/reports').then((m) => m.autoCrashReport(e)).catch(() => {});
  } catch { /* never let reporting crash the app */ }
};
