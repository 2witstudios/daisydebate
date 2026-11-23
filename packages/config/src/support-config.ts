import { z } from 'zod';

export const supportFields = {
  /**
   * SUPP-1: where support messages from /support go. Personal data, so it is
   * set in the deploy's secret store, never committed; absent, they go to
   * BETA_NOTIFY_EMAIL, and with neither they are stored and their email
   * waits until an address is set.
   */
  SUPPORT_NOTIFY_EMAIL: z.email().optional(),
};
