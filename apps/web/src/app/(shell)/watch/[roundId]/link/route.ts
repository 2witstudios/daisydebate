import { processRoute } from '../../../../../server/process-app';

export const runtime = 'nodejs';

/** /watch/:roundId/link: opens an audience link, then moves to the clean Round page. */
export const GET = processRoute(
  (routes) => (request) =>
    routes.audienceLink.open(
      request,
      new URL(request.url).pathname.split('/')[2] ?? '',
    ),
);
