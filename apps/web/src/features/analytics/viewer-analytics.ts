import { isTemporaryRefusal } from '@daisy/db/capacity';
import type { Identity } from '@daisy/auth';
import type { AnalyticsAvailability, Consent } from './consent';

/** A viewer's stored consent. A refusal says nothing about what they chose. */
export type StoredConsentRead =
  | { readonly kind: 'found'; readonly stored: Consent | null }
  | { readonly kind: 'refused' }
  | { readonly kind: 'not-asked' };

/**
 * What this viewer chose, as far as this render knows. Unreadable carries no
 * consent at all, so no surface can present a browser cookie as the stored one.
 */
export type ConsentChoice =
  | { readonly kind: 'known'; readonly consent: Consent }
  | { readonly kind: 'unreadable' };

type AnalyticsConfig = {
  readonly key: string | null;
  readonly host: string | null;
  readonly available: AnalyticsAvailability;
};

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

/** Whose stored consent applies; nobody's when signed out or unavailable. */
const viewerOf = (identity: Identity) =>
  identity.state === 'anonymous' || identity.state === 'unavailable'
    ? null
    : identity.principal.userId;

/** A signed-in viewer whose browser choice the stored consent has not caught up with. */
const adoptionDue = (stored: Consent | null, cookie: Consent) =>
  stored
    ? JSON.stringify(stored) !== JSON.stringify(cookie)
    : cookie.analytics !== 'unanswered' || cookie.replay !== 'unanswered';

const choiceOf = (
  identity: Identity,
  cookie: Consent,
  read: StoredConsentRead,
): ConsentChoice => {
  if (identity.state === 'unavailable' || read.kind === 'refused')
    return { kind: 'unreadable' };
  const stored = read.kind === 'found' ? read.stored : null;
  return { kind: 'known', consent: stored ?? cookie };
};

/**
 * What a render may do with analytics. Capture runs only with a key and a known
 * choice. With no key nothing is stored or read, so the cookie is the choice.
 */
export function analyticsView(input: {
  readonly config: AnalyticsConfig;
  readonly identity: Identity;
  readonly cookie: Consent;
  readonly read: StoredConsentRead;
}) {
  const { config, identity, cookie, read } = input;
  const { available } = config;
  if (!config.key)
    return {
      available,
      choice: { kind: 'known', consent: cookie } as ConsentChoice,
      capture: null,
    };
  const choice = choiceOf(identity, cookie, read);
  if (choice.kind === 'unreadable') return { available, choice, capture: null };
  const userId = viewerOf(identity);
  return {
    available,
    choice,
    capture: {
      keyValue: config.key,
      host: config.host,
      userId,
      needsAdoption:
        userId !== null &&
        adoptionDue(read.kind === 'found' ? read.stored : null, cookie),
      consent: choice.consent,
    },
  };
}

/** The view for this viewer, reading stored consent only when it can matter. */
export async function readViewerAnalytics(input: {
  readonly config: AnalyticsConfig;
  readonly identity: Identity;
  readonly cookie: Consent;
  readonly readConsent: (userId: string) => Promise<Consent | null>;
}) {
  const { config, identity, cookie, readConsent } = input;
  const userId = viewerOf(identity);
  return analyticsView({
    config,
    identity,
    cookie,
    read:
      config.key && userId
        ? await readStoredConsent(readConsent, userId)
        : { kind: 'not-asked' },
  });
}
