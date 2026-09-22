import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import {
  decideAccess,
  requestedPath,
  type Requirement,
  type SearchParams,
} from '../features/access/decision';
import { identify } from './identity';

/**
 * Server-component guard: resolves the durable session from this request's
 * cookies and redirects when the requirement is unmet. Call it from every
 * guarded page (and any server entrypoint under one) with that page's own
 * path and search params, so the return trip keeps the query; the proxy's cookie check is only an early hint, never this check.
 */
export async function requireAccess(
  path: string,
  requirement: Requirement,
  searchParams: Promise<SearchParams>,
): Promise<Identity> {
  const identity = await identify((await headers()).get('cookie'));
  const decision = decideAccess({
    identity,
    path: requestedPath(path, await searchParams),
    requirement,
  });
  // An outage renders the error boundary (retryable), never a sign-out.
  if (decision.kind === 'unavailable') throw createAppError('INFRASTRUCTURE');
  if (decision.kind === 'redirect') redirect(decision.to);
  return identity;
}
