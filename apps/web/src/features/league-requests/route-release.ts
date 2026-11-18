import type { App } from '../../server/app';
import { routeReleaseFor } from '../flags/route-release';

/** Whether League requests are open, read for no account: the form is the same signed in or out. */
export const leagueRequestsReleased = (app: App) => (): Promise<boolean> =>
  routeReleaseFor(app)('league-requests', null);
