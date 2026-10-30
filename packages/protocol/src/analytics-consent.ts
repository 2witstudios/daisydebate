import { z } from 'zod';

const choice = z.enum(['granted', 'denied', 'unanswered']);
/** Stable regardless of which vendors a deployment enables (ADR 0036). */
export const analyticsConsentSchema = z.strictObject({
  version: z.literal(1),
  necessary: z.literal('granted'),
  analytics: choice,
  replay: choice,
});
export type AnalyticsConsent = z.infer<typeof analyticsConsentSchema>;
