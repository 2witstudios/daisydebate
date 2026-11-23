import { processRoute } from '../../../../../server/process-app';
import { roomComposition } from '../../../../../features/room-runtime/composition';
type Params = Awaited<RouteContext<'/api/rooms/[roomId]/commands'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  roomComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.commands(request, roomId),
);
