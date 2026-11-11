import { sql } from 'drizzle-orm';
import { mailQueue } from './mail-queue';
import { mailIntents } from './schema/mail-intents';

/**
 * The durable mail queue's lifecycle writer (ADR 0075). Only an invitation
 * says a lapsed lease may have been delivered: its provider key expires, so
 * its operator must see that a resend may double it.
 */
export const mailIntentQueue = mailQueue(mailIntents, {
  unknownAfterLapse: sql`purpose = 'beta-invitation'`,
});
