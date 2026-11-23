import { after } from 'next/server';
import { routeReleaseFor } from '../../../../features/flags/route-release';
import { guardianCommandRoute } from '../../../../features/parental-controls/route';
import { processRoute } from '../../../../server/process-app';
import { authComposition } from '../../../../features/auth/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(authComposition, (routes, app) =>
  guardianCommandRoute(
    app,
    (id) => routeReleaseFor(app)('parental-controls', id),
    routes.POST,
    after,
  ),
);
