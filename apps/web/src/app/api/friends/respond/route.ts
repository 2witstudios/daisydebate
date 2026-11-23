import { processRoute } from '../../../../server/process-app';
import { friendComposition } from '../../../../features/friends/composition';
export const runtime = 'nodejs';
export const POST = processRoute(friendComposition, (routes) => routes.respond);
