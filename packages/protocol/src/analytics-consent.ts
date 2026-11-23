import { z } from 'zod';

/** One consent category's answer; `unanswered` counts as denied. */
export const consentChoices = ['granted', 'denied', 'unanswered'] as const;
const choice = z.enum(consentChoices);
/** Stable regardless of which vendors a deployment enables (ADR 0036). */
export const analyticsConsentSchema = z.strictObject({
  version: z.literal(1),
  necessary: z.literal('granted'),
  analytics: choice,
  replay: choice,
});
export type AnalyticsConsent = z.infer<typeof analyticsConsentSchema>;
