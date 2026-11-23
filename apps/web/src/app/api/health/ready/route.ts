import { processRoute } from '../../../../server/process-app';
import { opsComposition } from '../../../../features/ops/composition';

export const runtime = 'nodejs';

export const GET = processRoute(opsComposition, (routes) => routes.ready.GET);
