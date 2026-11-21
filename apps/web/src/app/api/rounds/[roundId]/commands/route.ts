import { processRouteWithParams } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/commands'>['params']>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.commands(request, roundId),
);
