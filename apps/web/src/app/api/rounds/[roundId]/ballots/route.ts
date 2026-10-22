import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (routes) => (request) =>
    routes.rounds.getBallots(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
export const POST = processRoute(
  (routes) => (request) =>
    routes.rounds.submitBallot(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
