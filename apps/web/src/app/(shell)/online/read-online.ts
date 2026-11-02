import {
  challengeListSchema,
  onlineRosterSchema,
  presenceSettingResultSchema,
} from '@daisy/protocol';
import { headers } from 'next/headers';
import { GET as readChallengesRoute } from '../../api/challenges/route';
import { GET as readOnlineRoute } from '../../api/online/route';
import { GET as readPresenceRoute } from '../../api/presence/route';
import { readOwnRoute } from '../friends/read-route';

/** The viewer's own view of who is online, through the route a script would call. */
export const readOnline = () =>
  readOwnRoute(readOnlineRoute, '/api/online', onlineRosterSchema);

/** The viewer's own challenges, and the actor id their inbox doorbell names. */
export async function readChallenges() {
  const response = await readChallengesRoute(
    new Request('http://in-process.invalid/api/challenges', {
      headers: new Headers(await headers()),
    }),
  );
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const parsed = challengeListSchema.loose().safeParse(body);
  if (!parsed.success) return null;
  const actorId = parsed.data['actorId'];
  return {
    list: parsed.data,
    actorId: typeof actorId === 'string' ? actorId : null,
    socketUrl: response.headers.get('x-realtime-socket-url'),
  };
}

/** The status the viewer chose. */
export const readChosenStatus = async () =>
  (await readOwnRoute(readPresenceRoute, '/api/presence', presenceSettingResultSchema))
    ?.status ?? 'online';
