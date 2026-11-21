import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/rematch'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.rooms.rematch(request, roomId),
);
