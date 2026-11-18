import type { Metadata } from 'next';
import { claimedUsername } from '@daisy/auth';
import { redirect } from 'next/navigation';
import {
  lobbyLandingHref,
  onboardingHref,
  usernameHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { readOnboardingEntry } from '../../../../lib/auth-entry';
import {
  requestHasRecordedAge,
  requestOnboardingDivision,
} from '../../../../lib/request-session';
import { YouthLanding } from '../../../../ui/onboarding/age/youth-landing';

export const metadata: Metadata = {
  title: 'Your lobby',
  robots: { index: false, follow: false },
};

/**
 * The landing after the age step (YLS-8): a member whose recorded age puts
 * them on the Youth ladder (13 to 17) is told so once; anyone else goes
 * straight on to the username step. An account that has not answered its
 * age goes back to that step; a finished account goes on.
 */
export default async function OnboardingLobbyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination, identity } = await readOnboardingEntry(
    searchParams,
    lobbyLandingHref,
  );
  if (claimedUsername(identity) !== null) redirect(destination);
  if (!(await requestHasRecordedAge())) redirect(onboardingHref(destination));
  if ((await requestOnboardingDivision()) !== 'youth')
    redirect(usernameHref(destination));
  return <YouthLanding next={usernameHref(destination)} />;
}
