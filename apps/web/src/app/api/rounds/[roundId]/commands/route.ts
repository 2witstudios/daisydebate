import { processRoute } from '../../../../../server/process-app';
import { roundComposition } from '../../../../../features/round-runtime/composition';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/commands'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  roundComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.commands(request, roundId),
);
