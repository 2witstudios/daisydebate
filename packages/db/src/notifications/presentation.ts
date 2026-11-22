import {
  defaultNotificationPresentation,
  type NotificationPresentation,
} from '@daisy/protocol/notifications';
import { sql, type SQL } from 'drizzle-orm';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { run, query } from '../raw-rows';
import type { TxSource } from '../tx';
import { z } from 'zod';

/** Whether Daisy may email the member `user` names at all; no row is yes. */
export const emailsMember = (user: SQL) =>
  sql`coalesce((select p.email from notification_presentation p where p.user_id=${user}),true)`;

/** A member's presentation choices and master email switch (ADR 0144). */
export const notificationPresentationOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readNotificationPresentation(input: {
    readonly userId: string;
  }): Promise<NotificationPresentation> {
    return instrumented(eventSink, 'readNotificationPresentation', async () => {
      const [row] = await query(
        database,
        z.object({
          email: z.boolean(),
          toasts: z.boolean(),
          sound: z.boolean(),
          desktopAlerts: z.boolean(),
        }),
        sql`select toasts,sound,desktop_alerts as "desktopAlerts",email
          from notification_presentation where user_id=${input.userId}`,
      );
      return row ?? defaultNotificationPresentation;
    });
  },
  /** An erased or unknown member changes nothing. */
  writeNotificationPresentation(input: {
    readonly userId: string;
    readonly presentation: NotificationPresentation;
  }) {
    return instrumented(
      eventSink,
      'writeNotificationPresentation',
      async () => {
        const p = input.presentation;
        await run(
          database,
          sql`insert into notification_presentation(user_id,toasts,sound,desktop_alerts,email)
        select u.id,${p.toasts},${p.sound},${p.desktopAlerts},${p.email} from users u
        where u.id=${input.userId} and u.deleted_at is null
        on conflict (user_id) do update set toasts=excluded.toasts,sound=excluded.sound,
          desktop_alerts=excluded.desktop_alerts,email=excluded.email`,
        );
      },
    );
  },
  /**
   * Stops every notification email for a member, from an email's one-click
   * unsubscribe; the rest of their choices are kept.
   */
  stopNotificationEmail(input: { readonly userId: string }) {
    return instrumented(eventSink, 'stopNotificationEmail', async () => {
      const d = defaultNotificationPresentation;
      await run(
        database,
        sql`insert into notification_presentation(user_id,toasts,sound,desktop_alerts,email)
        select u.id,${d.toasts},${d.sound},${d.desktopAlerts},false from users u
        where u.id=${input.userId} and u.deleted_at is null
        on conflict (user_id) do update set email=false`,
      );
    });
  },
});
