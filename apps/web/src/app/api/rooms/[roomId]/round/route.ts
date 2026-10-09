import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (routes) => (request) =>
    routes.rooms.roundRef(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
