import type { Metadata } from 'next';
import { systemId } from '@daisy/clock';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { requestLiveRoundsOf } from '../../../lib/request-session';
import { FriendsPage } from '../../../ui/friends/friends-page/friends-page';
import { friendAction } from './actions';
import { readFriends } from './read-friends';
import { MessageUserButton } from '../../../ui/messaging/message-user-button';
import { createConversationAction } from '../messages/new/actions';

export const metadata: Metadata = { title: 'Friends' };

export default async function Friends({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/friends', searchParams);
  const list = await readFriends();
  const live = await requestLiveRoundsOf(
    list?.friends.map((friend) => friend.username) ?? [],
  );
  return (
    <FriendsPage
      list={list}
      liveHrefs={new Map([...live].map(([name, card]) => [name, card.href]))}
      friendAction={friendAction}
      message={(username) => (
        <MessageUserButton
          username={username}
          requestId={systemId.next()}
          action={createConversationAction.bind(null, 'dm')}
        />
      )}
    />
  );
}
