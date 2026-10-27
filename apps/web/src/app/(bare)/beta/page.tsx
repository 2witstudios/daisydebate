import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readOnboardingEntry } from '../../../lib/auth-entry';
import {
  betaHref,
  onboardingHref,
  type SearchParams,
} from '../../../features/access/decision';
import { BetaWaiting } from '../../../ui/beta/beta-waiting';
import { signOutAction } from './actions';

export const metadata: Metadata = {
  title: "You're on the beta list",
  robots: { index: false, follow: false },
};

/**
 * Where an account waits for beta access (ADR 0075). Anyone else goes on:
 * a visitor signs in, an account without a username claims one, and an
 * approved member continues to the destination it was sent here from.
 */
export default async function BetaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination, identity } = await readOnboardingEntry(
    searchParams,
    betaHref,
  );
  if (identity.state === 'provisional') redirect(onboardingHref(destination));
  if (identity.state === 'member') redirect(destination);
  return (
    <BetaWaiting
      username={identity.username}
      reason={identity.reason}
      ageHref={onboardingHref('/beta')}
      signOutAction={signOutAction}
    />
  );
}
