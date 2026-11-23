import { processRoute } from '../../../../../../server/process-app';
import { roomCommunityComposition } from '../../../../../../features/messaging/room-community/composition';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/chat/edit'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  roomCommunityComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.edit(request, roomId),
);
