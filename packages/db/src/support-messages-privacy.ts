import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { query, run } from './raw-rows';

/**
 * A signed-in sender's support messages are theirs (compliance: support
 * messages): export returns them and erasure deletes them, sent or not. A
 * message sent signed out carries no account and is erased on request by
 * its reply address (docs/operations/support.md).
 */
export const supportMessagePrivacyAdopter: PrivacyAdopter = {
  id: 'support-messages',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await run(
      tx,
      sql`delete from support_messages where member_user_id = ${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    support_messages: exportRows(
      await query(
        tx,
        z.object({
          id: z.string(),
          topic: z.string(),
          message: z.string(),
          about: z.string().nullable(),
          reply_email: z.string(),
          created_at: z.date(),
        }),
        sql`select id, topic, message, about, reply_email, created_at from support_messages
          where member_user_id = ${subject.userId} order by created_at, id`,
      ),
    ),
  }),
};
