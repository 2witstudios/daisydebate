import { redirect } from 'next/navigation';
import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import {
  decideAccess,
  requestedPath,
  requirementFor,
  type SearchParams,
} from './decision';

/**
 * The page guard over a session reader. lib/access.ts binds it to this
 * request's cookies; a test binds it to a scripted identity, so what the test
 * proves is the guard that ships.
 */
export const accessGuard = (readIdentity: () => Promise<Identity>) => {
  const accessOrTemporary = async (
    path: string,
    searchParams: Promise<SearchParams>,
  ): Promise<
    | { readonly kind: 'allowed'; readonly identity: Identity }
    | { readonly kind: 'temporary' }
  > => {
    const requirement = requirementFor(path);
    // A page outside every guarded area calling the guard is a wiring error.
    if (requirement === null) throw createAppError('INTERNAL');
    const identity = await readIdentity();
    const decision = decideAccess({
      identity,
      path: requestedPath(path, await searchParams),
      requirement,
    });
    if (decision.kind === 'unavailable') {
      if (decision.temporary) return { kind: 'temporary' };
      throw createAppError('INFRASTRUCTURE');
    }
    if (decision.kind === 'redirect') redirect(decision.to);
    return { kind: 'allowed', identity };
  };

  const requireAccess = async (
    path: string,
    searchParams: Promise<SearchParams>,
  ): Promise<Identity> => {
    const access = await accessOrTemporary(path, searchParams);
    // An outage renders the error boundary (retryable), never a sign-out.
    if (access.kind === 'temporary') throw createAppError('INFRASTRUCTURE');
    return access.identity;
  };

  return { requireAccess, accessOrTemporary };
};
