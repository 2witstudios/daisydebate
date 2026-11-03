import { processRoute } from '../../../../../server/process-app';

export const runtime = 'nodejs';
export const POST = processRoute(
  (routes) => (request) =>
    routes.recordings.removal(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
