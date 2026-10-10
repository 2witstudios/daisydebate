import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const POST = processRoute(
  (routes) => (request) => routes.messaging.typing(request, true),
);
