import { headers } from 'next/headers';
import type { Identity } from '@daisy/auth';
import { returnDestination } from '../features/access/decision';
import { identify } from './identity';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * What the sign-in and onboarding pages start from: the validated `?next=`
 * destination (untrusted input; only a local path survives) and who is
 * asking, resolved from this request's durable session.
 */
export async function readAuthEntry(
  searchParams: SearchParams,
): Promise<{ readonly destination: string; readonly identity: Identity }> {
  const next = (await searchParams).next;
  return {
    destination: returnDestination(Array.isArray(next) ? next[0] : next),
    identity: await identify((await headers()).get('cookie')),
  };
}
