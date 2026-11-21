import { z } from 'zod';

export const betaFields = {
  /**
   * ADR 0075: where the owner's beta request digest goes. Personal data, so
   * it is set in the deploy's secret store, never committed; absent, owed
   * digests are cancelled as unconfigured.
   */
  BETA_NOTIFY_EMAIL: z.email().optional(),
};
