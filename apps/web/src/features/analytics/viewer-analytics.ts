import { isTemporaryRefusal } from '@daisy/db/capacity';
import type { Identity } from '@daisy/auth';
import type { AnalyticsAvailability, Consent } from './consent';

/** A viewer's stored consent. A refusal says nothing about what they chose. */
export type StoredConsentRead =
  | { readonly kind: 'found'; readonly stored: Consent | null }
  | { readonly kind: 'refused' };

/** Who is asking, with what their stored consent read answered. */
export type AnalyticsViewer =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'signed-out' }
  | {
      readonly kind: 'signed-in';
      readonly userId: string;
      readonly read: StoredConsentRead;
    };

export type Capture = {
  readonly keyValue: string;
  readonly host: string | null;
} & (
  | { readonly userId: null; readonly needsAdoption: false }
  | { readonly userId: string; readonly needsAdoption: boolean }
);

/**
 * What a render may do with analytics. Unreadable carries no consent, so no
 * surface can present a browser cookie as the stored choice, and no capture.
 */
export type AnalyticsView = {
  readonly available: AnalyticsAvailability;
} & (
  | {
      readonly choice: { readonly kind: 'known'; readonly consent: Consent };
      readonly capture: Capture | null;
    }
  | { readonly choice: { readonly kind: 'unreadable' }; readonly capture: null }
);
export type ConsentChoice = AnalyticsView['choice'];

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

/** Capture runs with a key and a known choice; a stored choice outranks the cookie. */
export function analyticsView(input: {
  readonly config: {
    readonly key: string;
    readonly host: string | null;
    readonly available: AnalyticsAvailability;
  };
  readonly cookie: Consent;
  readonly viewer: AnalyticsViewer;
}): AnalyticsView {
  const { config, cookie, viewer } = input;
  const { key: keyValue, host, available } = config;
  if (viewer.kind === 'unavailable')
    return { available, choice: { kind: 'unreadable' }, capture: null };
  if (viewer.kind === 'signed-out')
    return {
      available,
      choice: { kind: 'known', consent: cookie },
      capture: { keyValue, host, userId: null, needsAdoption: false },
    };
  if (viewer.read.kind === 'refused')
    return { available, choice: { kind: 'unreadable' }, capture: null };
  const { stored } = viewer.read;
  return {
    available,
    choice: { kind: 'known', consent: stored ?? cookie },
    capture: {
      keyValue,
      host,
      userId: viewer.userId,
      needsAdoption: adoptionDue(stored, cookie),
    },
  };
}

/** With no key nothing is stored or read, so the cookie is the choice. */
const unkeyedView = (
  available: AnalyticsAvailability,
  cookie: Consent,
): AnalyticsView => ({
  available,
  choice: { kind: 'known', consent: cookie },
  capture: null,
});

async function viewerOf(
  identity: Identity,
  readConsent: (userId: string) => Promise<Consent | null>,
): Promise<AnalyticsViewer> {
  if (identity.state === 'unavailable') return { kind: 'unavailable' };
  if (identity.state === 'anonymous') return { kind: 'signed-out' };
  const { userId } = identity.principal;
  return {
    kind: 'signed-in',
    userId,
    read: await readStoredConsent(readConsent, userId),
  };
}

/** The view for this viewer, reading stored consent only when it can matter. */
export async function readViewerAnalytics(input: {
  readonly config: {
    readonly key: string | null;
    readonly host: string | null;
    readonly available: AnalyticsAvailability;
  };
  readonly identity: Identity;
  readonly cookie: Consent;
  readonly readConsent: (userId: string) => Promise<Consent | null>;
}): Promise<AnalyticsView> {
  const { config, identity, cookie, readConsent } = input;
  if (!config.key) return unkeyedView(config.available, cookie);
  return analyticsView({
    config: { ...config, key: config.key },
    cookie,
    viewer: await viewerOf(identity, readConsent),
  });
}
