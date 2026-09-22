import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAppError } from '@daisy/errors';
import { readAuthEntry } from '../../../lib/auth-entry';
import { signInAgainHref } from '../../../ui/auth/better-auth-sign-in-port';
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
  const { destination, identity } = await readAuthEntry(searchParams);
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  if (identity.state === 'anonymous') redirect(signInAgainHref(destination));
  if (identity.state === 'member') redirect(destination);
  return <Onboarding destination={destination} />;
}
