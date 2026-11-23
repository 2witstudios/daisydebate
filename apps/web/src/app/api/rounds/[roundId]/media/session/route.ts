import { processRoute } from '../../../../../../server/process-app';
import { roundMediaComposition } from '../../../../../../features/round-media/composition';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/media/session'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  roundMediaComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.session(request, roundId),
);
