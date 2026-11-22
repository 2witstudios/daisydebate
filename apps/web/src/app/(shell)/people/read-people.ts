import { peopleListSchema } from '@daisy/protocol/people-list';
import { presenceSettingResultSchema } from '@daisy/protocol/presence-setting';
import { GET as readPeopleRoute } from '../../api/people/route';
import { GET as readPresenceRoute } from '../../api/presence/route';
import { readOwnRoute } from '../friends/read-route';

/** The viewer's own view of the people list, through the route a script would call. */
export const readPeople = () =>
  readOwnRoute(readPeopleRoute, '/api/people', peopleListSchema);

/** The status the viewer chose. */
export const readChosenStatus = async () =>
  (
    await readOwnRoute(
      readPresenceRoute,
      '/api/presence',
      presenceSettingResultSchema,
    )
  )?.status ?? 'online';
