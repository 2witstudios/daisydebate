import { processRoute } from '../../../server/process-app';
import { reportComposition } from '../../../features/reports/composition';
export const runtime = 'nodejs';
export const POST = processRoute(reportComposition, (routes) => routes.file);
