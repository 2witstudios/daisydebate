import { processRoute } from '../../../../../server/process-app';
import { mediaReleaseComposition } from '../../../../../features/media-releases/composition';

type Params = Awaited<RouteContext<'/api/clubs/[club]/releases'>['params']>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/clubs/<id or handle>/releases: the club's Youth students and their
 * releases, for its owner or a school's staff (ADR 0151); anyone else finds
 * nothing.
 */
export const GET = processRoute.withParams(
  mediaReleaseComposition,
  (routes) =>
    (request, { club }: Params) =>
      routes.clubRead(club)(request),
);

/** POST /api/clubs/<id>/releases: the club confirms releases it holds (ADR 0151). */
export const POST = processRoute.withParams(
  mediaReleaseComposition,
  (routes) =>
    (request, { club }: Params) =>
      routes.confirm(club)(request),
);
