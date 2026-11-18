import type { App } from '../../server/app';
import { routeReleaseFor } from '../flags/route-release';

/**
 * The youth-publishing flag's reader (PYL-8, ADR 0151), for the media release
 * routes. Only Next route modules and server actions import it, so release
 * flags stay out of the proxy's route table (ADR 0118).
 */
export const mediaReleasesReleased =
  (app: App) =>
  (accountId: string | null): Promise<boolean> =>
    routeReleaseFor(app)('youth-publishing', accountId);
