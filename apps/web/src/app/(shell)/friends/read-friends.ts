import { friendListSchema } from '@daisy/protocol/friends';
import { GET } from '../../api/friends/route';
import { readOwnRoute } from './read-route';

/** The viewer's own friend list, or null when it is refused or unavailable. */
export const readFriends = () =>
  readOwnRoute(GET, '/api/friends', friendListSchema);
