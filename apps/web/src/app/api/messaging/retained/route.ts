import { processRoute } from '../../../../server/process-app';
import { messagingComposition } from '../../../../features/messaging/composition';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(
  messagingComposition,
  (routes) => routes.retained.list,
);
