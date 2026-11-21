import { z } from 'zod';

export const serverTelemetryFields = {
  /**
   * ADR 0037: the error tracker's gates. Optional and never secret — a DSN
   * names where scrubbed events go and is designed to be public. With
   * `SENTRY_DSN` unset, no server capture path makes any Sentry network
   * call; `NEXT_PUBLIC_SENTRY_DSN` gates the browser capture only and reaches
   * the browser at request time, never through the build (ISSUE-1008).
   */
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),
};

export const webTelemetryFields = {
  ...serverTelemetryFields,
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
};
