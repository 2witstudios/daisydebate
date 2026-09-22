import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Identity } from '@daisy/auth';
import { decideAccess, type Requirement } from '../features/access/decision';
import { identify } from './identity';

/**
 * Server-component guard: resolves the durable session from this request's
 * cookies and redirects when the requirement is unmet. Call it from every
 * guarded page (and any server entrypoint under one) with that page's own
 * path; the proxy's cookie check is only an early hint, never this check.
 */
export async function requireAccess(
  path: string,
  requirement: Requirement,
): Promise<Identity> {
  const identity = await identify((await headers()).get('cookie'));
  const decision = decideAccess({ identity, path, requirement });
  if (decision.kind === 'redirect') redirect(decision.to);
  return identity;
}
