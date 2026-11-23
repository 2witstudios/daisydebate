import { mailJobStates } from '../schema/columns';
import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';
import { run, query } from '../raw-rows';
import { z } from 'zod';
import { scopeTransaction } from '../tenant-scope';

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
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    await run(
      tx,
      sql`delete from notifications
      where user_id=${subject.userId} or actor_id=${subject.actorId}
        or friendship_low_actor_id=${subject.actorId}
        or friendship_high_actor_id=${subject.actorId}`,
    );
    await run(
      tx,
      sql`delete from notification_digests where user_id=${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from notification_preferences where user_id=${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from notification_presentation where user_id=${subject.userId}`,
    );
    await scopeTransaction(tx, {});
  },
  export: async (tx, subject) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    const result = {
      notifications: exportRows(
        await query(
          tx,
          z.object({
            kind: z.string(),
            round_id: z.string().nullable(),
            room_invitation_id: z.string().nullable(),
            challenge_id: z.string().nullable(),
            dm_channel_id: z.string().nullable(),
            fixture_id: z.string().nullable(),
            notification_lobby_id: z.string().nullable(),
            tab_command_id: z.string().nullable(),
            media_release_request_id: z.string().nullable(),
            media_release_id: z.string().nullable(),
            media_release_club_ask_id: z.string().nullable(),
            read_at: z.date().nullable(),
            surfaced_at: z.date(),
            created_at: z.date(),
          }),
          sql`select kind,round_id,room_invitation_id,challenge_id,dm_channel_id,fixture_id,notification_lobby_id,tab_command_id,media_release_request_id,media_release_id,media_release_club_ask_id,read_at,surfaced_at,created_at
          from notifications where user_id=${subject.userId} order by created_at,id`,
        ),
      ),
      notification_preferences: exportRows(
        await query(
          tx,
          z.object({
            kind: z.string(),
            channel: z.string(),
            enabled: z.boolean(),
          }),
          sql`select kind,channel,enabled from notification_preferences
          where user_id=${subject.userId} order by kind,channel`,
        ),
      ),
      notification_presentation: exportRows(
        await query(
          tx,
          z.object({
            toasts: z.boolean(),
            sound: z.boolean(),
            desktop_alerts: z.boolean(),
            email: z.boolean(),
          }),
          sql`select toasts,sound,desktop_alerts,email from notification_presentation
          where user_id=${subject.userId}`,
        ),
      ),
      notification_digests: exportRows(
        await query(
          tx,
          z.object({
            state: z.enum(mailJobStates),
            attempts: z.int(),
            last_error_code: z.string().nullable(),
            first_owed_at: z.date(),
            created_at: z.date(),
            completed_at: z.date().nullable(),
          }),
          sql`select state,attempts,last_error_code,first_owed_at,created_at,completed_at
          from notification_digests where user_id=${subject.userId} order by created_at,id`,
        ),
      ),
    };
    await scopeTransaction(tx, {});
    return result;
  },
};
