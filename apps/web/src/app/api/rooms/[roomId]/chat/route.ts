import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (routes) => (request) =>
    routes.roomCommunity.discover(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
export const POST = processRoute(
  (routes) => (request) =>
    routes.roomCommunity.open(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
