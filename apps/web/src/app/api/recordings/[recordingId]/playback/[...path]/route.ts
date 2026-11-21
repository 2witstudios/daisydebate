import { processRoute } from '../../../../../../server/process-app';

export const runtime = 'nodejs';
/** /api/recordings/:recordingId/playback/...: one authorized read of its HLS. */
export const GET = processRoute((routes) => (request) => {
  const [, , , recordingId = '', , ...path] = new URL(
    request.url,
  ).pathname.split('/');
  return routes.recordings.playback(request, recordingId, path);
});
