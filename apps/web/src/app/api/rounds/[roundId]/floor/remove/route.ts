import { processRoute } from '../../../../../../server/process-app';
import { roundFloorComposition } from '../../../../../../features/messaging/round-floor/composition';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/floor/remove'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  roundFloorComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.remove(request, roundId),
);
