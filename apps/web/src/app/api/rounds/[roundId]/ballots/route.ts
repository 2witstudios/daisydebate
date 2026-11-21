import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/ballots'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.getBallots(request, roundId),
);
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.rounds.submitBallot(request, roundId),
);
