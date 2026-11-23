import { routeReleaseFor } from '../../../../features/flags/route-release';
import { createParticipantPageRoute } from '../../../../features/tab/participant-page-route';
import { memberHttpBoundary } from '../../../../server/member-boundary';
import { processRoute } from '../../../../server/process-app';
import { roomComposition } from '../../../../features/room-runtime/composition';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { readAssembly } from '../../../../features/rooms/read-assembly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(roomComposition, (routes, app) =>
  createParticipantPageRoute({
    boundary: memberHttpBoundary(app),
    store: app.database.tabCommands,
    released: (userId) => routeReleaseFor(app)('daisy-tab', userId),
    watchable: async (request, roomId) => {
      const response = await readAssembly(
        inProcessFetch(
          (roomRequest) => routes.read(roomRequest, roomId),
          request.headers,
        ),
        roomId,
        'event',
      );
      return response.kind === 'found' && response.view.watch !== null;
    },
  }),
);
