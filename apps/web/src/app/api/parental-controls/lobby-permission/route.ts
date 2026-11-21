import { routeReleaseFor } from '../../../../features/flags/route-release';
import { lobbyPermissionRoute } from '../../../../features/parental-controls/lobby-permission-route';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute((_routes, app) =>
  lobbyPermissionRoute(app, (id) =>
    routeReleaseFor(app)('parental-controls', id),
  ),
);
