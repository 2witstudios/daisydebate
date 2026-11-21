import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/chat'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.discover(request, roomId),
);
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.open(request, roomId),
);
