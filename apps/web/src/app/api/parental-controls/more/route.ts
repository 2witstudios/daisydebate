import { guardianMoreRoute } from '../../../../features/parental-controls/more-route';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute((_, app) => guardianMoreRoute(app));
