import { processRoute } from '../../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/recordings/<roundId>/publish: a debater shares a Youth Recording (ADR 0151). */
export const POST = processRoute(
  (routes) => (request) =>
    routes.mediaReleases.publish(
      new URL(request.url).pathname.split('/')[3] ?? '',
    )(request),
);
