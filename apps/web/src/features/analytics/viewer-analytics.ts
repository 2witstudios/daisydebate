import { isTemporaryRefusal } from '@daisy/db/capacity';
import type { Identity } from '@daisy/auth';
import type { AnalyticsAvailability, Consent } from './consent';

/** A viewer's stored consent. A refusal says nothing about what they chose. */
export type StoredConsentRead =
  | { readonly kind: 'found'; readonly stored: Consent | null }
  | { readonly kind: 'refused' };

export async function readStoredConsent(
  read: (userId: string) => Promise<Consent | null>,
  userId: string,
): Promise<StoredConsentRead> {
  try {
    return { kind: 'found', stored: await read(userId) };
  } catch (error) {
    if (!isTemporaryRefusal(error)) throw error;
    return { kind: 'refused' };
  }
}

/** A signed-in viewer whose browser choice the stored consent has not caught up with. */
const adoptionDue = (stored: Consent | null, cookie: Consent) =>
  stored
    ? JSON.stringify(stored) !== JSON.stringify(cookie)
    : cookie.analytics !== 'unanswered' || cookie.replay !== 'unanswered';

/** Whose stored consent applies; nobody's when signed out or unavailable. */
export const analyticsViewerOf = (identity: Identity) =>
  identity.state === 'anonymous' || identity.state === 'unavailable'
    ? null
    : identity.principal.userId;

/**
 * What a render may do with analytics. A refused read turns analytics off for
 * this render, adopts nothing, and marks the choice unreadable, so a preference
 * surface says so rather than present the browser's cookie as the stored choice.
 */
export function analyticsView(input: {
  readonly config: {
    readonly key: string;
    readonly host: string | null;
    readonly available: AnalyticsAvailability;
  };
  readonly identity: Identity;
  readonly cookie: Consent;
  readonly read: StoredConsentRead;
}) {
  const { config, identity, cookie, read } = input;
  const userId = analyticsViewerOf(identity);
  const stored = read.kind === 'found' ? read.stored : null;
  const refused = read.kind === 'refused';
  return {
    needsAdoption: Boolean(userId) && !refused && adoptionDue(stored, cookie),
    keyValue: identity.state === 'unavailable' || refused ? null : config.key,
    host: config.host,
    userId,
    consent: stored ?? cookie,
    consentUnreadable: refused,
    available: config.available,
  };
}
