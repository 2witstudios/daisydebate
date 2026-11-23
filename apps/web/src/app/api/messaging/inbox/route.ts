import { processRoute } from '../../../../server/process-app';
import { messagingComposition } from '../../../../features/messaging/composition';
export const GET = processRoute(messagingComposition, (routes) => routes.inbox);
