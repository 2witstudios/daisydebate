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
