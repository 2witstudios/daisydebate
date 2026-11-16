import { hostNavigationViewSchema } from '@daisy/protocol/lobby/host-navigation-read';
import { hostNavigationPath } from '../../../features/tab/host-navigation-route';
import { readOwnRoute } from '../../(shell)/friends/read-route';
import { GET } from '../../api/tab/host-navigation/route';

/** Shell metadata passes the same evaluated request boundary as every area. */
export const readStoredHostNavigation = (
  kind: 'organization' | 'lobby',
  handle: string,
) =>
  readOwnRoute(GET, hostNavigationPath(kind, handle), hostNavigationViewSchema);
