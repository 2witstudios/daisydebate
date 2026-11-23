import { processRoute } from '../../../../../server/process-app';
import { audienceComposition } from '../../../../../features/spectating/audience-composition';

type Params = Awaited<RouteContext<'/api/rounds/[roundId]/chat'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  audienceComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.chat(request, roundId),
);
