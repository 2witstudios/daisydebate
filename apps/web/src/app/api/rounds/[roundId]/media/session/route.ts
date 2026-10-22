import { processRoute } from '../../../../../../server/process-app';
export const runtime = 'nodejs';
export const POST = processRoute(
  (routes) => (request) =>
    routes.roundMedia.session(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
