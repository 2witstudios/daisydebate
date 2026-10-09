import { processRoute } from '../../../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (routes) => (request) =>
    routes.messaging.search(
      request,
      new URL(request.url).pathname.split('/')[4] ?? '',
    ),
);
