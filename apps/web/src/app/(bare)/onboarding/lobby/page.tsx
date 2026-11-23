import type { Metadata } from 'next';
import { claimedUsername } from '@daisy/auth';
import { redirect } from 'next/navigation';
import {
  lobbyLandingHref,
  usernameHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { readOnboardingEntry } from '../../../../lib/auth-entry';
import { requestLandingLobby } from '../../../../features/lobby/page-reads';
import { YouthLanding } from '../../../../ui/onboarding/age/youth-landing';

export const metadata: Metadata = {
  title: 'Your lobby',
  robots: { index: false, follow: false },
};

/**
 * The landing after the age step (YLS-8): a member whose recorded age puts
 * them on the Youth ladder (13 to 17) is told so; anyone else, including an
 * account with no valid age record, goes on to the username step, whose own
 * guard sends an unanswered account back to the age step. A finished
 * account goes on. One read: the division is null without an age record.
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
  const lobby = await requestLandingLobby();
  if (lobby?.ageRule !== 'under-18') redirect(usernameHref(destination));
  return (
    <YouthLanding lobbyName={lobby.name} next={usernameHref(destination)} />
  );
}
