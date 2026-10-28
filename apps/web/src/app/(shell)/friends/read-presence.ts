import { presenceSettingResultSchema } from '@daisy/protocol';
import { GET } from '../../api/presence/route';
import { readOwnRoute } from './read-route';

/** The viewer's own presence setting, through Presence's own route. */
export const readPresence = () =>
  readOwnRoute(GET, '/api/presence', presenceSettingResultSchema);
