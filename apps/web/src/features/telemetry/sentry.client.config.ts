import { browserCaptureConfig } from './browser-capture';
import { initSentry } from './sentry-init';

/**
 * ADR 0037 § Configuration: `NEXT_PUBLIC_SENTRY_DSN` gates the browser
 * capture only, and reaches it at request time on `<html>`, never through the
 * build (ISSUE-1008). With it unset the browser makes no Sentry network call,
 * even if the server DSN is set. There is no session replay here: replay is
 * PostHog's, gated separately on consent (ADR 0036 §5).
 */
initSentry(browserCaptureConfig(document.documentElement.dataset));
