import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { claimedUsername } from '@daisy/auth';
import { requireAccess } from '../../../../../lib/access';
import type { SearchParams } from '../../../../../features/access/decision';
import { clubInvitationViewSchema } from '../../../../../features/clubs/views';
import { ClubInvitationPage } from '../../../../../ui/clubs/invitation-page';
import { readOwnRoute } from '../../../friends/read-route';
import { GET } from '../../../../api/clubs/invitations/[invitation]/route';
import { requireClubRelease } from '../../release';
import { clubInvitationAction } from '../../actions';

export const metadata: Metadata = { title: 'Club invitation' };

const reference = /^[a-z0-9]{24}\.[a-z0-9]{24}$/;

/**
 * An emailed seat invitation. Only an account signed in with the invited,
 * verified address sees it; anyone else finds no such page.
 */
export default async function ClubInvitation({
  params,
  searchParams,
}: {
  params: Promise<{ invitation: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { invitation } = await params;
  const identity = await requireAccess(
    `/clubs/invitations/${invitation}`,
    searchParams,
  );
  await requireClubRelease(identity);
  if (!reference.test(invitation)) notFound();
  const view = await readOwnRoute(
    (request) => GET(request, { params: Promise.resolve({ invitation }) }),
    `/api/clubs/invitations/${invitation}`,
    clubInvitationViewSchema,
  );
  if (!view) notFound();
  return (
    <ClubInvitationPage
      view={view}
      username={claimedUsername(identity)}
      action={clubInvitationAction.bind(null, invitation)}
    />
  );
}
