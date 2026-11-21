import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rooms/[roomId]/chat/remove'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.remove(request, roomId),
);
