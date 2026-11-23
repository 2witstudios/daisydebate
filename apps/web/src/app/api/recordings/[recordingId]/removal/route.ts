import { processRoute } from '../../../../../server/process-app';
import { recordingComposition } from '../../../../../features/recording/composition';

type Params = Awaited<
  RouteContext<'/api/recordings/[recordingId]/removal'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  recordingComposition,
  (routes) =>
    (request, { recordingId }: Params) =>
      routes.removal(request, recordingId),
);
