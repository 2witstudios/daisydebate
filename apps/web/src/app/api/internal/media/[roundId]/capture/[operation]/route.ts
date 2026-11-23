import { processRoute } from '../../../../../../../server/process-app';
import { mediaCaptureComposition } from '../../../../../../../features/media-capture/composition';

type Params = Awaited<
  RouteContext<'/api/internal/media/[roundId]/capture/[operation]'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  mediaCaptureComposition,
  (routes) =>
    (request, { operation }: Params) =>
      routes.handle(request, operation),
);
