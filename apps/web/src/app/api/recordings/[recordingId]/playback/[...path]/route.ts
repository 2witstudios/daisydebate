import { processRoute } from '../../../../../../server/process-app';
import { recordingComposition } from '../../../../../../features/recording/composition';

type Params = Awaited<
  RouteContext<'/api/recordings/[recordingId]/playback/[...path]'>['params']
>;

export const runtime = 'nodejs';
/** /api/recordings/:recordingId/playback/...: one authorized read of its HLS. */
export const GET = processRoute.withParams(
  recordingComposition,
  (routes) =>
    (request, { recordingId, path }: Params) =>
      routes.playback(request, recordingId, path),
);
