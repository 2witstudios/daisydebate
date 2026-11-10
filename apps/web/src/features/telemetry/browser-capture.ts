import { sentryRelease } from './sentry-release';

/**
 * Browser capture's runtime configuration (ISSUE-1008): the root layout writes
 * it on `<html>` per request and `sentry.client.config.ts` reads it there, so
 * it comes from the same process configuration as the CSP that admits the
 * capture origin, and one image serves any environment. A DSN is public by
 * design (ADR 0037), and so is the release, the image's git commit, which
 * matches the server's events and the uploaded source maps. Without a DSN,
 * no attribute exists, and the browser initializes nothing.
 */
export const browserCaptureAttributes = (config: {
  readonly NEXT_PUBLIC_SENTRY_DSN?: string | undefined;
  readonly SENTRY_ENVIRONMENT?: string | undefined;
  readonly GIT_COMMIT?: string | undefined;
}): Readonly<Record<string, string>> => {
  if (!config.NEXT_PUBLIC_SENTRY_DSN) return {};
  const release = sentryRelease(config.GIT_COMMIT);
  return {
    'data-sentry-dsn': config.NEXT_PUBLIC_SENTRY_DSN,
    ...(config.SENTRY_ENVIRONMENT
      ? { 'data-sentry-environment': config.SENTRY_ENVIRONMENT }
      : {}),
    ...(release ? { 'data-sentry-release': release } : {}),
  };
};

/** What the browser reads back from `document.documentElement.dataset`. */
export const browserCaptureConfig = (
  dataset: Readonly<Record<string, string | undefined>>,
) => ({
  dsn: dataset.sentryDsn,
  environment: dataset.sentryEnvironment,
  release: dataset.sentryRelease,
});
