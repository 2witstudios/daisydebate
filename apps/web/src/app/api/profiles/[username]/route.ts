import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (routes) => (request) =>
    routes.profiles.read(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
