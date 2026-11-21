import { processRoute } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rooms/[roomId]/chat/remove'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.remove(request, roomId),
);
