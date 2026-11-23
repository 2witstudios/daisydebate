import { processRoute } from '../../../server/process-app';
import { challengeComposition } from '../../../features/challenges/composition';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(challengeComposition, (routes) => routes.list);
export const POST = processRoute(challengeComposition, (routes) => routes.send);
