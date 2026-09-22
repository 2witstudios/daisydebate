import type { Identity } from '@daisy/auth';
import { safeLocalDestination } from '../auth/redirect';

/**
 * `participant`: an account with a public username. `account`: any verified
 * account, including one still choosing a username (security and recovery).
 */
export type Requirement = 'participant' | 'account';

export type AccessDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'redirect'; readonly to: string };

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
  if (identity.state === 'anonymous') return via('/sign-in', path);
  if (identity.state === 'provisional' && requirement === 'participant')
    return via('/onboarding/username', path);
  return { kind: 'allow' };
}
