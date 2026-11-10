import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';
import { rowsOf } from '../raw-rows';

/**
 * The subject's notifications, choices and email jobs go, and any
 * notification telling someone else about the subject (that they were on
 * air, invited them, or challenged them).
 */
export const notificationPrivacyAdopter: PrivacyAdopter = {
  id: 'notifications',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from notification_emails where user_id=${subject.userId}`,
    );
    await tx.execute(sql`delete from notifications
      where user_id=${subject.userId} or actor_id=${subject.actorId}`);
    await tx.execute(
      sql`delete from notification_preferences where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    notifications: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select kind,round_id,room_invitation_id,challenge_id,read_at,created_at
          from notifications where user_id=${subject.userId} order by created_at,id`,
      ),
    ),
    notification_preferences: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select kind,channel,enabled from notification_preferences
          where user_id=${subject.userId} order by kind,channel`,
      ),
    ),
    notification_emails: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select kind,state,attempts,last_error_code,created_at,completed_at
          from notification_emails where user_id=${subject.userId} order by created_at,id`,
      ),
    ),
  }),
};
