import {
  onlineRosterSchema,
  presenceSettingResultSchema,
} from '@daisy/protocol';
import { GET as readOnlineRoute } from '../../api/online/route';
import { GET as readPresenceRoute } from '../../api/presence/route';
import { readOwnRoute } from '../friends/read-route';

/** The viewer's own view of who is online, through the route a script would call. */
export const readOnline = () =>
  readOwnRoute(readOnlineRoute, '/api/online', onlineRosterSchema);

/** The status the viewer chose. */
export const readChosenStatus = async () =>
  (
    await readOwnRoute(
      readPresenceRoute,
      '/api/presence',
      presenceSettingResultSchema,
    )
  )?.status ?? 'online';
