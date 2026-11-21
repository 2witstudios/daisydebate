import { processRoute } from '../../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/chat/edit'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roomId }) =>
      routes.roomCommunity.edit(request, roomId),
);
