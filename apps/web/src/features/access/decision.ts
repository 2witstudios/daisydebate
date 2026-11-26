import type { Identity } from '@daisy/auth';
import { returnableDestination } from '../auth/redirect';

/**
 * `participant`: an approved account with a public username (ADR 0075).
 * `account`: any verified account, including one still choosing a username
 * or waiting for beta access (security, recovery and privacy rights).
 */
export type Requirement = 'participant' | 'account';

export type AccessDecision =
  | { readonly kind: 'allow' }
  /** The session store is down: refuse with a retryable error, not sign-in. */
  | { readonly kind: 'unavailable'; readonly temporary?: true }
  | { readonly kind: 'redirect'; readonly to: string };

/**
 * Areas that need an account, and what each needs. Spectator routes are
 * absent, so they need none. Descendants inherit the longest matching entry.
 */
const GUARDED_AREAS: Readonly<Record<string, Requirement>> = {
  '/play': 'participant',
  '/ranked': 'participant',
  '/lobby': 'participant',
  '/rooms': 'participant',
  '/rounds': 'participant',
  '/judge': 'participant',
  '/notifications': 'participant',
  '/friends': 'participant',
  '/messages': 'participant',
  '/prep': 'participant',
  '/train': 'participant',
  '/settings': 'account',
  // Tournaments' info page stays public; these areas under it stay guarded for
  // when its screens exist (ADR 0043).
  '/tournaments/directory': 'participant',
  '/tournaments/organize': 'participant',
  '/tournaments/mine': 'participant',
  '/tournaments/enter': 'participant',
  // A Tab league is read by its members only; its pages and its host pages
  // recheck the session, so a visitor is sent to sign in (Delivery 5072).
  '/leagues': 'participant',
  '/host/leagues': 'participant',
  // Club seats (ADR 0148): a club's pages and an emailed seat invitation,
  // which only the invited address's own account can answer.
  '/clubs': 'participant',
};

/**
 * Each guarded area as a whole-segment path pattern, longest first. Its first
 * segment follows a single slash; any later run of slashes counts as one.
 */
const areaPatterns = Object.keys(GUARDED_AREAS)
  .sort((left, right) => right.length - left.length)
  .map(
    (area) =>
      [
        area,
        new RegExp(
          `^/${area
            .slice(1)
            .split('/')
            .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('/+')}(?:/|$)`,
        ),
      ] as const,
  );

/**
 * Guarded areas whose bare root is a public page (ADR 0935): `/leagues`
 * introduces leagues to a visitor, while a league's own pages beneath it
 * stay guarded. Only the root itself, with or without trailing slashes.
 */
const publicRoots: ReadonlyMap<string, RegExp> = new Map(
  ['/leagues'].map((area) => [area, new RegExp(`^${area}/*$`)] as const),
);

/**
 * The guarded area a path belongs to: the longest entry the path is, or
 * begins as a whole segment, or null. A path that does not begin with one
 * non-empty segment is public (so `//lobby` and `/lobbyist` stay public);
 * later runs of slashes count as one, so a doubled slash cannot step out of
 * an area.
 */
export const guardedAreaFor = (pathname: string): string | null => {
  const area =
    areaPatterns.find(([, pattern]) => pattern.test(pathname))?.[0] ?? null;
  return area !== null && publicRoots.get(area)?.test(pathname) ? null : area;
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

/**
 * The start of onboarding for an account without a username: the age step
 * (WAIT-4.6), which goes on to the username step, then the destination.
 */
export const onboardingHref = (destination: string): string =>
  `/onboarding/age?next=${encodeURIComponent(destination)}`;

/**
 * After the age step: the Youth landing for a member under 18, straight on
 * to the username step for anyone else (decision 88, YLS-8).
 */
export const lobbyLandingHref = (destination: string): string =>
  `/onboarding/lobby?next=${encodeURIComponent(destination)}`;

/** Choose a username, once the age step is answered, then the destination. */
export const usernameHref = (destination: string): string =>
  `/onboarding/username?next=${encodeURIComponent(destination)}`;

/** The beta waiting page (ADR 0075), then the destination once approved. */
export const betaHref = (destination: string): string =>
  `/beta?next=${encodeURIComponent(destination)}`;

/** Where a suspended or banned account lands (ADR 0103). */
export const RESTRICTED_HREF = '/restricted';

/** The restricted page, keeping a failed sign-out's notice from the page it left. */
export const restrictedHref = (search: SearchParams): string =>
  search.signOut === 'failed'
    ? `${RESTRICTED_HREF}?signOut=failed`
    : RESTRICTED_HREF;

/** The passkey offer after a claimed username, then the destination. */
export const passkeyOfferHref = (destination: string): string =>
  `/onboarding/passkey?next=${encodeURIComponent(destination)}`;

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
  if (identity.state === 'unavailable')
    return identity.temporary
      ? { kind: 'unavailable', temporary: true }
      : { kind: 'unavailable' };
  if (identity.state === 'anonymous')
    return redirectTo(signInHref(returnableDestination(path)));
  if (requirement === 'account') return { kind: 'allow' };
  switch (identity.state) {
    case 'provisional':
      return redirectTo(onboardingHref(returnableDestination(path)));
    case 'waitlisted':
      return redirectTo(betaHref(returnableDestination(path)));
    case 'restricted':
      return redirectTo(RESTRICTED_HREF);
    case 'member':
      return { kind: 'allow' };
  }
}
