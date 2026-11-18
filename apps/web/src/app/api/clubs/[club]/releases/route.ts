import { processRoute } from '../../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/clubs/<id>/releases: the club confirms releases it holds (ADR 0151). */
export const POST = processRoute(
  (routes) => (request) =>
    routes.mediaReleases.confirm(
      new URL(request.url).pathname.split('/')[3] ?? '',
    )(request),
);
