import { mediaReleasesReleased } from '../../../../features/media-releases/route-release';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** POST /api/media-releases/publish {roundId}: a debater shares a Youth Recording. */
export const POST = processRoute((routes, app) =>
  routes.mediaReleases.publish(mediaReleasesReleased(app)),
);
