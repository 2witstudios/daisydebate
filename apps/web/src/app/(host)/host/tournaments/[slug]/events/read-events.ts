import { hostEventsViewSchema } from '@daisy/protocol/lobby/host-events-read';
import { hostEventsPath } from '../../../../../../features/tab/host-events-route';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { GET } from '../../../../../api/tab/host-events/route';

export const readStoredHostEvents = (lobbyId: string) =>
  readOwnRoute(GET, hostEventsPath(lobbyId), hostEventsViewSchema);
