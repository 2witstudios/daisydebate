import { processRoute } from '../../../../../server/process-app';
import { recordingComposition } from '../../../../../features/recording/composition';

type Params = Awaited<
  RouteContext<'/api/recordings/[recordingId]/download'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  recordingComposition,
  (routes) =>
    (request, { recordingId }: Params) =>
      routes.download(request, recordingId),
);
