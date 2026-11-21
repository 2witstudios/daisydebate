import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/round-analysis'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.getRoundAnalysis(request, roundId),
);

export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.requestRoundAnalysis(request, roundId),
);
