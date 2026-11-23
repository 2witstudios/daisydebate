import { processRoute } from '../../../../../server/process-app';
import { roundComposition } from '../../../../../features/round-runtime/composition';

type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/transcript'>['params']
>;

export const GET = processRoute.withParams(
  roundComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.transcript(request, roundId),
);
