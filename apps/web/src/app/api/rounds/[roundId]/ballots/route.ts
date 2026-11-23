import { processRoute } from '../../../../../server/process-app';
import { roundBallotComposition } from '../../../../../features/round-ballots/composition';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/ballots'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  roundBallotComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.getBallots(request, roundId),
);
export const POST = processRoute.withParams(
  roundBallotComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.submitBallot(request, roundId),
);
