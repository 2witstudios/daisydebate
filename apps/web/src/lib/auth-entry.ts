import { headers } from 'next/headers';
import type { Identity } from '@daisy/auth';
import {
  nextDestination,
  type SearchParams,
} from '../features/access/decision';
import { identify } from './identity';

/**
 * What the sign-in and onboarding pages start from: the validated `?next=`
 * destination (untrusted input; only a local path survives) and who is
 * asking, resolved from this request's durable session.
 */
export async function readAuthEntry(
  searchParams: Promise<SearchParams>,
): Promise<{ readonly destination: string; readonly identity: Identity }> {
  return {
    destination: nextDestination(await searchParams),
    identity: await identify(await headers()),
  };
}
