import { processRoute } from '../../../server/process-app';
import { presenceComposition } from '../../../features/presence/composition';
export const runtime = 'nodejs';
export const POST = processRoute(presenceComposition, (routes) => routes.set);
export const GET = processRoute(presenceComposition, (routes) => routes.read);
