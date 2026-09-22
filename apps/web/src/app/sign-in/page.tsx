import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { returnDestination } from '../../features/access/decision';
import { identify } from '../../lib/identity';
import { onboardingDestination } from '../../ui/auth/better-auth-sign-in-port';
import { SignIn } from '../../ui/auth/sign-in/sign-in';

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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = (await searchParams).next;
  const destination = returnDestination(Array.isArray(next) ? next[0] : next);
  const identity = await identify((await headers()).get('cookie'));
  if (identity.state === 'member') redirect(destination);
  if (identity.state === 'provisional')
    redirect(onboardingDestination(destination));
  return <SignIn destination={destination} />;
}
