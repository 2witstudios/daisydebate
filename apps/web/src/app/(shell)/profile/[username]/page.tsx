import { parseUsername } from '@daisy/auth';
import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProfile } from '../../../../features/profile/get-profile';
import { requestIdentity } from '../../../../lib/request-session';
import { ProfilePage } from '../../../../ui/profile/profile-page/profile-page';

export const metadata: Metadata = { title: 'Profile' };

/** Public: anyone may read a debater's profile. */
export default async function ProfileRoute({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  if (!parseUsername(username).ok) notFound();
  const identity = await requestIdentity();
  const viewer = identity.state === 'member' ? identity.username : null;
  return (
    <ProfilePage profile={getProfile(username, viewer, systemClock.now())} />
  );
}
