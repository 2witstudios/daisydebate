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

/** Better Auth's session cookie, plain on HTTP and `__Secure-` on HTTPS. */
export const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
] as const;

/** Areas that need an account; spectator routes stay public. */
const GUARDED_ROOTS = [
  '/play',
  '/ranked',
  '/lobby',
  '/judge',
  '/recordings',
  '/settings',
] as const;

/** True for a guarded root or any descendant of one. */
export const isGuardedPath = (pathname: string): boolean =>
  GUARDED_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );

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

/** The requested page as a local path with its query, for the return trip. */
export const requestedPath = (path: string, search: SearchParams): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    for (const item of typeof value === 'string' ? [value] : (value ?? []))
      query.append(key, item);
  const encoded = query.toString();
  return encoded === '' ? path : `${path}?${encoded}`;
};

/** `/sign-in` or onboarding, carrying only a validated local destination. */
const via = (route: string, path: string): AccessDecision => ({
  kind: 'redirect',
  to: `${route}?next=${encodeURIComponent(returnDestination(path))}`,
});

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
  if (identity.state === 'anonymous') return via('/sign-in', path);
  if (identity.state === 'provisional' && requirement === 'participant')
    return via('/onboarding/username', path);
  return { kind: 'allow' };
}
