import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { run } from './raw-rows';

/**
 * Export returns what the subject reported and whether they are banned.
 * Erasure clears their name from their reports, which stand as a moderation
 * record with no reporter, and deletes the ban, which has no one left to bind.
 */
export const contentModerationPrivacyAdopter: PrivacyAdopter = {
  id: 'content-moderation',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await run(
      tx,
      sql`update content_reports set reporter_user_id = null where reporter_user_id = ${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from audience_bans where user_id = ${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    content_reports:
      await tx.execute(sql`select target_kind, target_id, reason, status,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from content_reports where reporter_user_id = ${subject.userId}
      order by created_at, id`),
    audience_bans: await tx.execute(sql`select
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from audience_bans where user_id = ${subject.userId}`),
  }),
};
