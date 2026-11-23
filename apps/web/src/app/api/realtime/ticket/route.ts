import { processRoute } from '../../../../server/process-app';
import { ticketComposition } from '../../../../features/realtime/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(ticketComposition, (routes) => routes.POST);
