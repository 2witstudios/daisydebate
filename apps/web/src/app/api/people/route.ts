import { processRoute } from '../../../server/process-app';
import { presenceComposition } from '../../../features/presence/composition';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(presenceComposition, (routes) => routes.people);
