import { processRoute } from '../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.rooms.read(request, roomId),
);
