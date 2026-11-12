import { processRoute } from '../../../../../../server/process-app';
export const runtime = 'nodejs';
export const POST = processRoute(
  (routes) => (request) =>
    routes.roomCommunity.markRead(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
