import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAppError } from '@daisy/errors';
import { readAuthEntry } from '../../../../lib/auth-entry';
import {
  onboardingHref,
  passkeyOfferHref,
  signInHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { PasskeyOffer } from '../../../../ui/auth/onboarding/passkey-offer';

export const metadata: Metadata = {
  title: 'Save a passkey',
  robots: { index: false, follow: false },
};

/**
 * The passkey offer that follows a claimed username. The claim redirects
 * here, with or without JavaScript. An account still choosing a name goes
 * back to that step; anonymous visitors sign in first.
 */
export default async function OnboardingPasskeyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination, identity } = await readAuthEntry(searchParams);
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  if (identity.state === 'anonymous')
    redirect(signInHref(passkeyOfferHref(destination)));
  if (identity.state === 'provisional') redirect(onboardingHref(destination));
  return (
    <PasskeyOffer username={identity.username} destination={destination} />
  );
}
