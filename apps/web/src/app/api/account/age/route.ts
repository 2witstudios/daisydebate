import { routeReleaseFor } from '../../../../features/flags/route-release';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute((routes, app) =>
  routes.age.withParentalControls((id) =>
    routeReleaseFor(app)('parental-controls', id),
  ),
);
