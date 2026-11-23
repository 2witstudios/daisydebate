import { processRoute } from '../../../../server/process-app';
import { roundBallotComposition } from '../../../../features/round-ballots/composition';
export const runtime = 'nodejs';
export const GET = processRoute(
  roundBallotComposition,
  (routes) => (request) => routes.judgeAssignments(request),
);
