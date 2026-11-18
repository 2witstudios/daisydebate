import type { App } from '../../server/app';
import { routeReleaseFor } from '../flags/route-release';

/** Whether Daisy Tab is released to an account, for a Tab route. */
export const tabReleasedFor =
  (app: App) =>
  (userId: string): Promise<boolean> =>
    routeReleaseFor(app)('daisy-tab', userId);
export const tabMinorsReleasedFor =
  (app: App) =>
  (userId: string): Promise<boolean> =>
    routeReleaseFor(app)('daisy-tab-minors', userId);
/** Host tiers ride on Tab: both must be released (ADR 0149). */
export const hostTiersReleasedFor =
  (app: App) =>
  async (userId: string): Promise<boolean> =>
    (await tabReleasedFor(app)(userId)) &&
    routeReleaseFor(app)('host-tiers', userId);
