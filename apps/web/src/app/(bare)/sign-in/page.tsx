import type { Metadata } from 'next';
import { claimedUsername } from '@daisy/auth';
import { redirect } from 'next/navigation';
import { readAuthEntry } from '../../../lib/auth-entry';
import {
  onboardingHref,
  type SearchParams,
} from '../../../features/access/decision';
import { SignIn } from '../../../ui/auth/sign-in/sign-in';
import { requestLinkAction } from './actions';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

/**
 * Sign-in over Better Auth. `?next=` is untrusted: only a validated local
 * path survives. Someone already signed in is sent straight on, through
 * username onboarding if they never finished it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination, identity } = await readAuthEntry(searchParams);
  // A waitlisted account goes on too: the destination's guard sends it to
  // the beta page when it needs approval (ADR 0075).
  if (claimedUsername(identity) !== null) redirect(destination);
  if (identity.state === 'provisional') redirect(onboardingHref(destination));
  return (
    <SignIn
      destination={destination}
      requestLink={requestLinkAction.bind(null, destination)}
    />
  );
}
