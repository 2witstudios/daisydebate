import type { Identity } from '@daisy/auth';
import { returnableDestination } from '../auth/redirect';

/**
 * `participant`: an account with a public username. `account`: any verified
 * account, including one still choosing a username (security and recovery).
 */
export type Requirement = 'participant' | 'account';

export type AccessDecision =
  | { readonly kind: 'allow' }
  /** The session store is down: refuse with a retryable error, not sign-in. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'redirect'; readonly to: string };

/**
 * Areas that need an account, and what each needs. Spectator routes are
 * absent, so they stay public. Descendants inherit the longest matching entry.
 */
const GUARDED_AREAS: Readonly<Record<string, Requirement>> = {
  '/play': 'participant',
  '/ranked': 'participant',
  '/lobby': 'participant',
  '/rooms': 'participant',
  '/debates': 'participant',
  '/judge': 'participant',
  '/notifications': 'participant',
  '/messages': 'participant',
  '/recordings': 'participant',
  '/prep': 'participant',
  '/train': 'participant',
  '/settings': 'account',
  // A public root (Tournaments) holds guarded areas: the organizer console
  // (any organizer, never an admin surface, ADR 0043), a participant's own
  // events and the registration flow.
  '/tournaments/organize': 'participant',
  '/tournaments/mine': 'participant',
  '/tournaments/enter': 'participant',
};

/**
 * The guarded area a path belongs to: the longest entry that is a whole
 * leading run of its segments, or null. The first segment is read exactly as
 * it always was (so `//lobby` and `/lobbyist` stay public); later empty
 * segments are dropped, so a doubled slash cannot step out of an area.
 */
export const guardedAreaFor = (pathname: string): string | null => {
  const [, first = '', ...rest] = pathname.split('/');
  if (first === '') return null;
  const segments = [first, ...rest.filter((segment) => segment !== '')];
  for (let depth = segments.length; depth > 0; depth -= 1) {
    const area = `/${segments.slice(0, depth).join('/')}`;
    if (area in GUARDED_AREAS) return area;
  }
  return null;
};

/** The requirement for a guarded area or descendant, or null when public. */
export const requirementFor = (pathname: string): Requirement | null => {
  const area = guardedAreaFor(pathname);
  return area === null ? null : (GUARDED_AREAS[area] ?? null);
};

/** True for a guarded root or any descendant of one. */
export const isGuardedPath = (pathname: string): boolean =>
  requirementFor(pathname) !== null;

export type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/** The validated `?next=` destination of a page's (untrusted) query. */
export const nextDestination = (search: SearchParams): string => {
  const next = search.next;
  return returnableDestination(typeof next === 'string' ? next : next?.[0]);
};

/** Sign in, then continue to an already validated destination. */
export const signInHref = (destination: string): string =>
  `/sign-in?next=${encodeURIComponent(destination)}`;

/** Choose a username, then continue to an already validated destination. */
export const onboardingHref = (destination: string): string =>
  `/onboarding/username?next=${encodeURIComponent(destination)}`;

/** The passkey offer after a claimed username, then the destination. */
export const passkeyOfferHref = (destination: string): string =>
  `/onboarding/passkey?next=${encodeURIComponent(destination)}`;

/** The onboarding steps after the passkey offer. */
export type OnboardingStep =
  'welcome' | 'daisy' | 'debate' | 'about' | 'experience' | 'topics' | 'ready';

/** One onboarding step, then the already validated destination. */
export const onboardingStepHref = (
  step: OnboardingStep,
  destination: string,
): string => `/onboarding/${step}?next=${encodeURIComponent(destination)}`;

/** The first onboarding step, where the passkey offer's exits lead. */
export const welcomeHref = (destination: string): string =>
  onboardingStepHref('welcome', destination);

/** The requested page as a local path with its query, for the return trip. */
export const requestedPath = (path: string, search: SearchParams): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    for (const item of typeof value === 'string' ? [value] : (value ?? []))
      query.append(key, item);
  const encoded = query.toString();
  return encoded === '' ? path : `${path}?${encoded}`;
};

const redirectTo = (to: string): AccessDecision => ({ kind: 'redirect', to });

/**
 * Pure access decision for one server entrypoint. Every guarded page and
 * handler calls this with a freshly resolved Identity; the proxy alone is
 * never the check.
 */
export function decideAccess({
  identity,
  path,
  requirement,
}: {
  readonly identity: Identity;
  readonly path: string;
  readonly requirement: Requirement;
}): AccessDecision {
  if (identity.state === 'unavailable') return { kind: 'unavailable' };
  if (identity.state === 'anonymous')
    return redirectTo(signInHref(returnableDestination(path)));
  if (identity.state === 'provisional' && requirement === 'participant')
    return redirectTo(onboardingHref(returnableDestination(path)));
  return { kind: 'allow' };
}
