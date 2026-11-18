import { mediaReleasesReleased } from '../../../../../features/media-releases/route-release';
import { processRoute } from '../../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clubOf = (request: Request) =>
  new URL(request.url).pathname.split('/')[3] ?? '';

/**
 * GET /api/clubs/<id or handle>/releases: the club's Youth students and their
 * releases, for its owner or a school's staff, while youth publishing is
 * open (ADR 0151); anyone else finds nothing.
 */
export const GET = processRoute(
  (routes, app) => (request) =>
    routes.mediaReleases.clubRead(clubOf(request))(mediaReleasesReleased(app))(
      request,
    ),
);

/** POST /api/clubs/<id>/releases: the club confirms releases it holds (ADR 0151). */
export const POST = processRoute(
  (routes, app) => (request) =>
    routes.mediaReleases.confirm(clubOf(request))(mediaReleasesReleased(app))(
      request,
    ),
);
