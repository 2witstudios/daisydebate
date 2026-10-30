import { analyticsConsentSchema, type AnalyticsConsent } from '@daisy/protocol';

export const CONSENT_COOKIE = 'daisy_consent';
const consentSchema = analyticsConsentSchema;
export type Consent = AnalyticsConsent;
export type AnalyticsAvailability = {
  readonly analytics: boolean;
  readonly replay: boolean;
};
export const unansweredConsent: Consent = {
  version: 1,
  necessary: 'granted',
  analytics: 'unanswered',
  replay: 'unanswered',
};

export function parseConsent(value: string | undefined): Consent {
  try {
    return consentSchema.parse(JSON.parse(value ?? ''));
  } catch {
    return { ...unansweredConsent };
  }
}

export const consentNeeded = (
  consent: Consent,
  available: AnalyticsAvailability,
) =>
  (['analytics', 'replay'] as const).filter(
    (key) => available[key] && consent[key] === 'unanswered',
  );

export const mergeConsent = (
  prior: Consent,
  choices: Partial<Pick<Consent, 'analytics' | 'replay'>>,
): Consent => consentSchema.parse({ ...prior, ...choices });
