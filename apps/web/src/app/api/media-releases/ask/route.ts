import { mediaReleasesReleased } from '../../../../features/media-releases/route-release';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute((routes, app) =>
  routes.mediaReleases.ask(mediaReleasesReleased(app)),
);
