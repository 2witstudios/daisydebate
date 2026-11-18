import { createAppError } from '@daisy/errors';
import { routeReleaseFor } from '../../../../../features/flags/route-release';
import {
  memberHttpBoundary,
  runMemberRoute,
} from '../../../../../server/member-boundary';
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
  (_routes, app) => (request) =>
    runMemberRoute(
      memberHttpBoundary(app),
      request,
      {
        name: 'media-release.club-read',
        readOnly: true,
        bucket: 'media-release:club-read',
        rule: { max: 120, windowSeconds: 60 },
      },
      async (caller) => {
        const club = clubOf(request);
        if (
          club.length > 80 ||
          !(await routeReleaseFor(app)('youth-publishing', caller.userId))
        )
          throw createAppError('NOT_FOUND');
        const read = await app.database.mediaReleaseClubs.readClubReleases(
          caller.userId,
          decodeURIComponent(club),
        );
        if (read === null) throw createAppError('NOT_FOUND');
        return Response.json(
          { read, nowMs: Date.parse(app.clock.now()) },
          { headers: { 'cache-control': 'no-store' } },
        );
      },
    ),
);

/** POST /api/clubs/<id>/releases: the club confirms releases it holds (ADR 0151). */
export const POST = processRoute(
  (routes) => (request) =>
    routes.mediaReleases.confirm(clubOf(request))(request),
);
