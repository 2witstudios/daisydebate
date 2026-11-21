import { processRouteWithParams } from '../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/transcript'>['params']
>;

export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.transcript(request, roundId),
);
