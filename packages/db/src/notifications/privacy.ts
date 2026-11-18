import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';
import { rowsOf } from '../raw-rows';

/**
 * The subject's notifications, choices, presentation and digests go, and any
 * notification telling someone else about the subject (that they were on
 * air, invited them, challenged them, or asked or accepted a friendship).
 * An export names a friendship by its kind alone: the other member's id is
 * theirs, not the subject's.
 */
export const notificationPrivacyAdopter: PrivacyAdopter = {
  id: 'notifications',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(sql`delete from notifications
      where user_id=${subject.userId} or actor_id=${subject.actorId}
        or friendship_low_actor_id=${subject.actorId}
        or friendship_high_actor_id=${subject.actorId}`);
    await tx.execute(
      sql`delete from notification_digests where user_id=${subject.userId}`,
    );
    await tx.execute(
      sql`delete from notification_preferences where user_id=${subject.userId}`,
    );
    await tx.execute(
      sql`delete from notification_presentation where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    notifications: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select kind,round_id,room_invitation_id,challenge_id,fixture_id,notification_lobby_id,tab_command_id,read_at,surfaced_at,created_at
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
    notification_presentation: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select toasts,sound,desktop_alerts,email from notification_presentation
          where user_id=${subject.userId}`,
      ),
    ),
    notification_digests: exportRows(
      await rowsOf<Record<string, unknown>>(
        tx,
        sql`select state,attempts,last_error_code,first_owed_at,created_at,completed_at
          from notification_digests where user_id=${subject.userId} order by created_at,id`,
      ),
    ),
  }),
};
