import { processRouteWithParams } from '../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/round-analysis'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.getRoundAnalysis(request, roundId),
);

export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.requestRoundAnalysis(request, roundId),
);
