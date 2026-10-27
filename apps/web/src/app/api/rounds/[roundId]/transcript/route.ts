import { processRoute } from '../../../../../server/process-app';

export const GET = processRoute(
  (routes) => (request) =>
    routes.rounds.transcript(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
