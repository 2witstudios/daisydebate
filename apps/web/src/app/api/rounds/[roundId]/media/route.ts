import { processRoute } from '../../../../../server/process-app';
import { roundMediaComposition } from '../../../../../features/round-media/composition';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/media'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  roundMediaComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.read(request, roundId),
);
