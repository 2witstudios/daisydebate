import { after } from 'next/server';
import { routeReleaseFor } from '../../../../features/flags/route-release';
import { guardianCommandRoute } from '../../../../features/parental-controls/route';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute((routes, app) =>
  guardianCommandRoute(
    app,
    (id) => routeReleaseFor(app)('parental-controls', id),
    routes.auth.POST,
    after,
  ),
);
