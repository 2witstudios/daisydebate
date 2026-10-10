import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (routes) => (request) =>
    routes.messaging.requestPreview(
      request,
      new URL(request.url).pathname.split('/')[4] ?? '',
    ),
);
