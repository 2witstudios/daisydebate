import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/commands'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.commands(request, roundId),
);
