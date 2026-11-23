import { processRoute } from '../../../../../../server/process-app';
import { roomCommunityComposition } from '../../../../../../features/messaging/room-community/composition';
type Params = Awaited<
  RouteContext<'/api/rooms/[roomId]/chat/messages'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  roomCommunityComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.history(request, roomId),
);
export const POST = processRoute.withParams(
  roomCommunityComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.send(request, roomId),
);
