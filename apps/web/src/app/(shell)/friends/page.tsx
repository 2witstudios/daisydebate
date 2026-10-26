import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { FriendsPage } from '../../../ui/friends/friends-page/friends-page';
import { challengeAction, friendAction } from './actions';
import { readFriends } from './read-friends';

export const metadata: Metadata = { title: 'Friends' };

export default async function Friends({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/friends', searchParams);
  return (
    <FriendsPage
      list={await readFriends()}
      friendAction={friendAction}
      challengeAction={challengeAction}
    />
  );
}
