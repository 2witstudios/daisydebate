import { processRoute } from '../../../../server/process-app';
import { roomComposition } from '../../../../features/room-runtime/composition';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  roomComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.read(request, roomId),
);
