import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/chat/read'>['params']>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.markRead(request, roomId),
);
