import { processRouteWithParams } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/commands'>['params']>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.rooms.commands(request, roomId),
);
