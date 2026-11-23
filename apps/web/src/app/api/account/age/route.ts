import { routeReleaseFor } from '../../../../features/flags/route-release';
import { processRoute } from '../../../../server/process-app';
import { ageComposition } from '../../../../features/account/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(ageComposition, (routes, app) =>
  routes.withParentalControls((id) =>
    routeReleaseFor(app)('parental-controls', id),
  ),
);
