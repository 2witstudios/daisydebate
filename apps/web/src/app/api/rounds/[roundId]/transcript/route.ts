import { processRoute } from '../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/transcript'>['params']
>;

export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.transcript(request, roundId),
);
