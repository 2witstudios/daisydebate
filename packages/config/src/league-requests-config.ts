import { z } from 'zod';

export const leagueRequestsFields = {
  /**
   * PYL-17: where League requests ("Talk to us") go. Personal data, so it is
   * set in the deploy's secret store, never committed; absent, they go to
   * BETA_NOTIFY_EMAIL, and with neither they are stored and their email
   * waits until an address is set.
   */
  LEAGUE_REQUEST_NOTIFY_EMAIL: z.email().optional(),
};
