import { processRoute } from '../../../../../server/process-app';
import { roomCommunityComposition } from '../../../../../features/messaging/room-community/composition';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/chat'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  roomCommunityComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.discover(request, roomId),
);
export const POST = processRoute.withParams(
  roomCommunityComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.open(request, roomId),
);
