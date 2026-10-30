import { initSentry } from './sentry-init';

/**
 * ADR 0037 § Configuration: `SENTRY_DSN` gates every server-side capture
 * path. With it unset this file initializes nothing and no server runtime
 * makes any Sentry network call. These vendor seam files read their own
 * gate directly, exactly as `@sentry/nextjs`'s per-runtime config
 * convention expects.
 */
initSentry({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
});
