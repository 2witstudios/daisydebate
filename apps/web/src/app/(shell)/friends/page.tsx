import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { friendListSchema } from '@daisy/protocol';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { FriendsPage } from '../../../ui/friends/friends-page/friends-page';
import { GET } from '../../api/friends/route';
import { challengeAction, friendAction } from './actions';

export const metadata: Metadata = { title: 'Friends' };

/** The member's own list, through the same route a script would read. */
async function readFriends() {
  try {
    const response = await GET(
      new Request('http://in-process.invalid/api/friends', {
        headers: new Headers(await headers()),
      }),
    );
    if (!response.ok) return null;
    const list = friendListSchema.safeParse(await response.json());
    return list.success ? list.data : null;
  } catch {
    return null;
  }
}

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
