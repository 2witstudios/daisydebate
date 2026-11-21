import { processRouteWithParams } from '../../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/recordings/[recordingId]/playback/[...path]'>['params']
>;

export const runtime = 'nodejs';
/** /api/recordings/:recordingId/playback/...: one authorized read of its HLS. */
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { recordingId, path }) =>
      routes.recordings.playback(request, recordingId, path),
);
