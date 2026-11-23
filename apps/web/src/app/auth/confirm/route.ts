import { processRoute } from '../../../server/process-app';
import { confirmComposition } from '../../../features/auth/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = processRoute(confirmComposition, (routes) => routes.GET);
export const HEAD = processRoute(confirmComposition, (routes) => routes.HEAD);
export const POST = processRoute(confirmComposition, (routes) => routes.POST);
