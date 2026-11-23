import { processRoute } from '../../../../../server/process-app';
import { roundAnalysisComposition } from '../../../../../features/round-analysis/composition';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/round-analysis'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  roundAnalysisComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.getRoundAnalysis(request, roundId),
);

export const POST = processRoute.withParams(
  roundAnalysisComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.requestRoundAnalysis(request, roundId),
);
