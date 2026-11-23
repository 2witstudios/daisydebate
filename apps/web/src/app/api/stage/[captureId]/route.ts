import { processRoute } from '../../../../server/process-app';
import { stageComposition } from '../../../../features/stage-capture/composition';
type Params = Awaited<RouteContext<'/api/stage/[captureId]'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  stageComposition,
  (routes) =>
    (request, { captureId }: Params) =>
      routes(request, captureId),
);
