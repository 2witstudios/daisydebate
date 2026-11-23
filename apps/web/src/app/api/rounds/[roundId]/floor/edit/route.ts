import { processRoute } from '../../../../../../server/process-app';
import { roundFloorComposition } from '../../../../../../features/messaging/round-floor/composition';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/floor/edit'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  roundFloorComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.edit(request, roundId),
);
