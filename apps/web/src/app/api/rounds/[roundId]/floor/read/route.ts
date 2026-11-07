import { processRoute } from '../../../../../../server/process-app';
export const runtime = 'nodejs';
export const POST = processRoute(
  (routes) => (request) =>
    routes.roundFloor.markRead(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
