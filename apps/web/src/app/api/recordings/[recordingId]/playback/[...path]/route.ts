import { mediaReleasesReleased } from '../../../../../../features/media-releases/route-release';
import { processRoute } from '../../../../../../server/process-app';

export const runtime = 'nodejs';
/** /api/recordings/:recordingId/playback/...: one authorized read of its HLS. */
export const GET = processRoute((routes, app) => (request) => {
  const [, , , recordingId = '', , ...path] = new URL(
    request.url,
  ).pathname.split('/');
  const released = mediaReleasesReleased(app);
  return routes.recordings.playbackWith(() => released(null))(
    request,
    recordingId,
    path,
  );
});
