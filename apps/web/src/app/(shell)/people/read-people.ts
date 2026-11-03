import { peopleListSchema, presenceSettingResultSchema } from '@daisy/protocol';
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
