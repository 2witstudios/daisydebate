import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (routes) => (request) =>
    routes.rounds.getRoundAnalysis(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);

export const POST = processRoute(
  (routes) => (request) =>
    routes.rounds.requestRoundAnalysis(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
