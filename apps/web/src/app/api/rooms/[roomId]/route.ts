import { processRouteWithParams } from '../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]'>['params']>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.rooms.read(request, roomId),
);
