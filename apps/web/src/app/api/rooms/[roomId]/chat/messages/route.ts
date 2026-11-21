import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rooms/[roomId]/chat/messages'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.history(request, roomId),
);
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.send(request, roomId),
);
