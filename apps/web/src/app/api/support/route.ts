import { supportComposition } from '../../../features/support/composition';
import { processRoute } from '../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute(supportComposition, (routes) => routes.POST);
