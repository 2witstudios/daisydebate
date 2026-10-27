import { headers } from 'next/headers';
import { friendListSchema, type FriendList } from '@daisy/protocol';
import { GET } from '../../api/friends/route';

/**
 * The viewer's own friend list for a server render, through the same route
 * a script would read, with this request's headers; null when it is refused
 * or unavailable.
 */
export async function readFriends(): Promise<FriendList | null> {
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
