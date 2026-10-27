import { parseUsername } from '@daisy/auth';
import { systemId } from '@daisy/clock';
import { matchHistoryQuerySchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { ProfilePage } from '../../../../ui/profile/profile-page/profile-page';
import {
  requestIdentity,
  requestMemberProfile,
} from '../../../../lib/request-session';
import { ProfileFriendActions } from '../../../../ui/friends/profile-friend-actions';
import { relationTo } from '../../../../ui/friends/friends';
import { challengeAction, friendAction } from '../../friends/actions';
import { readFriends } from '../../friends/read-friends';
import { MessageUserButton } from '../../../../ui/messaging/message-user-button';
import { createConversationAction } from '../../messages/new/actions';

export const metadata: Metadata = { title: 'Profile' };

/** Public: anyone may read a member's profile; only its owner sees every Round. */
export default async function ProfileRoute({
  params,
  searchParams,
}: {
  readonly params: Promise<{ username: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { username } = await params;
  const name = parseUsername(username);
  if (!name.ok) notFound();
  const raw = await searchParams;
  const query = matchHistoryQuerySchema.safeParse(
    typeof raw.before === 'string' ? { before: raw.before } : {},
  );
  if (!query.success) notFound();
  // Null: no live member holds the name, or the cursor names no Round the
  // viewer may list. Either way there is no such page.
  const profile = await requestMemberProfile(name.username, query.data);
  if (profile === null) notFound();
  return (
    <ProfilePage
      profile={profile}
      paged={query.data.before !== undefined}
      actions={profile.me ? null : await friendActionsFor(profile.username)}
    />
  );
}

/**
 * A member's Add friend or Challenge, and Message, toward someone else;
 * nothing for a visitor. Message goes through the ordinary DM request, so a
 * friendship never bypasses DM admission.
 */
async function friendActionsFor(username: string) {
  if ((await requestIdentity()).state !== 'member') return null;
  const list = await readFriends();
  return (
    <>
      {list ? (
        <ProfileFriendActions
          username={username}
          relation={relationTo(list, username)}
          friendAction={friendAction}
          challengeAction={challengeAction}
        />
      ) : null}
      <MessageUserButton
        username={username}
        requestId={systemId.next()}
        action={createConversationAction.bind(null, 'dm')}
      />
    </>
  );
}
