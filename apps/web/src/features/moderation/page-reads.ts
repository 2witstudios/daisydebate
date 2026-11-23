import { requestApp } from '../../lib/page-reads';

/** When this account's suspension ends; null for a ban or nothing in force. */
export const requestRestrictionEnd = (userId: string) => {
  const app = requestApp();
  return app.database.readRestrictionEnd({ userId, now: app.clock.now() });
};
