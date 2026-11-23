import { processRoute } from '../../../../../server/process-app';
import { roundFloorComposition } from '../../../../../features/messaging/round-floor/composition';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/floor'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  roundFloorComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.discover(request, roundId),
);
export const POST = processRoute.withParams(
  roundFloorComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.open(request, roundId),
);
