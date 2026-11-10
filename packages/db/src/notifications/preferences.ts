import {
  defaultNotificationChoices,
  type EmailedNotificationKind,
  notificationChoicePairs,
  type NotificationChannel,
  type NotificationChoices,
  type NotificationKind,
} from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { rowsOf } from '../raw-rows';

/** Whether `user` wants `kind` on `channel`: on unless they turned it off. */
export const wants = (
  kind: NotificationKind,
  channel: NotificationChannel,
  user: SQL,
) =>
  sql`coalesce((select np.enabled from notification_preferences np
    where np.user_id=${user} and np.kind=${kind} and np.channel=${channel}),true)`;

/** A member's choices: every kind and channel, read per pair (ADR 0124). */
export const notificationPreferenceOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readNotificationPreferences(input: {
    readonly userId: string;
  }): Promise<NotificationChoices> {
    return instrumented(eventSink, 'readNotificationPreferences', async () => {
      const rows = await rowsOf<{
        kind: NotificationKind;
        channel: NotificationChannel;
        enabled: boolean;
      }>(
        database,
        sql`select kind,channel,enabled from notification_preferences where user_id=${input.userId}`,
      );
      const choices = structuredClone(defaultNotificationChoices) as Record<
        NotificationKind,
        Partial<Record<NotificationChannel, boolean>>
      >;
      for (const row of rows) choices[row.kind][row.channel] = row.enabled;
      return choices as NotificationChoices;
    });
  },
  writeNotificationPreferences(input: {
    readonly userId: string;
    readonly choices: NotificationChoices;
  }) {
    return instrumented(eventSink, 'writeNotificationPreferences', () =>
      database.transaction(async (tx) => {
        for (const { kind, channel } of notificationChoicePairs) {
          const enabled = (
            input.choices[kind] as Partial<Record<NotificationChannel, boolean>>
          )[channel];
          await tx.execute(sql`insert into notification_preferences(user_id,kind,channel,enabled)
            select u.id,${kind},${channel},${enabled ?? true} from users u
            where u.id=${input.userId} and u.deleted_at is null
            on conflict (user_id,kind,channel) do update set enabled=excluded.enabled`);
        }
      }),
    );
  },
  /**
   * Turns one kind's email off for a member, from the email's own
   * unsubscribe (ADR 0124). An erased or unknown member changes nothing.
   */
  unsubscribeNotificationEmail(input: {
    readonly userId: string;
    readonly kind: EmailedNotificationKind;
  }) {
    return instrumented(eventSink, 'unsubscribeNotificationEmail', async () => {
      await database.execute(sql`insert into notification_preferences(user_id,kind,channel,enabled)
        select u.id,${input.kind},'email',false from users u
        where u.id=${input.userId} and u.deleted_at is null
        on conflict (user_id,kind,channel) do update set enabled=false`);
    });
  },
});
