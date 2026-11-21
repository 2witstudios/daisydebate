import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rooms/[roomId]/chat/report'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.report(request, roomId),
);
