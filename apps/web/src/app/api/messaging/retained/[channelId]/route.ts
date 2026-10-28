import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(
  (routes) => (request) =>
    routes.messaging.retained.read(
      request,
      new URL(request.url).pathname.split('/')[4] ?? '',
    ),
);
