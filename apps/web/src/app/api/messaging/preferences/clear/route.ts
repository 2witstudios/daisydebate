import { processRoute } from '../../../../../server/process-app';
import { messagingComposition } from '../../../../../features/messaging/composition';
export const runtime = 'nodejs';
export const POST = processRoute(
  messagingComposition,
  (routes) => (request) => routes.preferences(request, 'clear'),
);
