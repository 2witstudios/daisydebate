import { processRoute } from '../../../../server/process-app';
import { friendComposition } from '../../../../features/friends/composition';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(friendComposition, (routes) => routes.counts);
