import { processRoute } from '../../../../../../server/process-app';
export const GET = processRoute(
  (routes) => (request) =>
    routes.messaging.requestStatus(
      request,
      new URL(request.url).pathname.split('/')[4] ?? '',
    ),
);
