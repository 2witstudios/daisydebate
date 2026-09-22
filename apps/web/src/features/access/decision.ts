import type { Identity } from '@daisy/auth';
import { safeLocalDestination } from '../auth/redirect';

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
 * absent, so they stay public. Descendants inherit their root's entry.
 */
const GUARDED_AREAS: Readonly<Record<string, Requirement>> = {
  '/play': 'participant',
  '/ranked': 'participant',
  '/lobby': 'participant',
  '/judge': 'participant',
  '/recordings': 'participant',
  '/settings': 'account',
};

/** The requirement for a guarded root or descendant, or null when public. */
export const requirementFor = (pathname: string): Requirement | null => {
  const root = `/${pathname.split('/')[1] ?? ''}`;
  return GUARDED_AREAS[root] ?? null;
};

/** True for a guarded root or any descendant of one. */
export const isGuardedPath = (pathname: string): boolean =>
  requirementFor(pathname) !== null;

/** Routes that are never a place to return to: they would loop or misuse it. */
const NEVER_A_DESTINATION = /^\/(?:sign-in|auth|api)(?:[/?#]|$)/;

/**
 * Where to send someone after sign-in or onboarding: a validated local path
 * (never absolute or protocol-relative), else the lobby.
 */
export const returnDestination = (value: string | null | undefined): string => {
  const destination = safeLocalDestination(value);
  return NEVER_A_DESTINATION.test(destination) ? '/lobby' : destination;
};

export type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/** The validated `?next=` destination of a page's (untrusted) query. */
export const nextDestination = (search: SearchParams): string => {
  const next = search.next;
  return returnDestination(typeof next === 'string' ? next : next?.[0]);
};

/** Sign in, then continue to an already validated destination. */
export const signInHref = (destination: string): string =>
  `/sign-in?next=${encodeURIComponent(destination)}`;

/** Choose a username, then continue to an already validated destination. */
export const onboardingHref = (destination: string): string =>
  `/onboarding/username?next=${encodeURIComponent(destination)}`;

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
    return redirectTo(signInHref(returnDestination(path)));
  if (identity.state === 'provisional' && requirement === 'participant')
    return redirectTo(onboardingHref(returnDestination(path)));
  return { kind: 'allow' };
}
