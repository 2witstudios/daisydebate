import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { returnDestination } from '../../../features/access/decision';
import { identify } from '../../../lib/identity';
import { Onboarding } from '../../../ui/auth/onboarding/onboarding';

export const metadata: Metadata = {
  title: 'Choose a username',
  robots: { index: false, follow: false },
};

/**
 * Username onboarding. Anonymous visitors sign in first and return here; a
 * finished account goes straight on. Signing in again after an interrupted
 * signup lands here too, because the participant guard sends provisional
 * accounts to this page.
 */
export default async function OnboardingUsernamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = (await searchParams).next;
  const destination = returnDestination(Array.isArray(next) ? next[0] : next);
  const identity = await identify((await headers()).get('cookie'));
  if (identity.state === 'anonymous')
    redirect(
      `/sign-in?next=${encodeURIComponent(`/onboarding/username?next=${encodeURIComponent(destination)}`)}`,
    );
  if (identity.state === 'member') redirect(destination);
  return <Onboarding destination={destination} />;
}
