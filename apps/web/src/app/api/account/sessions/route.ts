import { processRoute } from '../../../../server/process-app';
import { sessionsComposition } from '../../../../features/account/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = processRoute(sessionsComposition, (routes) => routes.GET);
