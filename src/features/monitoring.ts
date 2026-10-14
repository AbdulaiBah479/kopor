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
    release: `kopor@${import.meta.env.VITE_APP_VERSION ?? '2.1.0'}`,
    // Sentry v11 collects no personal data by default; beforeSend below scrubs anything left.
    tracesSampleRate: 0,
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

export const reportError = (e: unknown) => { try { capture?.(e); } catch { /* never let reporting crash the app */ } };
