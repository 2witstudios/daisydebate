/**
 * The client boundary's scrubbed capture (ADR 0037): the `global-error`
 * boundary calls this from its retry effect. The SDK loads on demand, so a
 * bundle that never reports never loads it, and `captureException` is
 * inert unless `sentry.client.config.ts` initialized the SDK with
 * `NEXT_PUBLIC_SENTRY_DSN`.
 */
export const reportClientError = (error: unknown): void => {
  void import('@sentry/nextjs').then(({ captureException }) =>
    captureException(error),
  );
};
