import { processRouteWithParams } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/rematch'>['params']>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.rooms.rematch(request, roomId),
);
