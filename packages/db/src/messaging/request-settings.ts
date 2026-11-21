import {
  messageRequestSettingSchema,
  type MessageRequestSetting,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { query, run } from '../raw-rows';
import { inTransaction, type TxSource } from '../tx';

/**
 * A member's own "who can send me message requests" (decision 90, ADR 0160).
 * No row is everyone; choosing everyone removes the row.
 */
export const messageRequestSettingOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readMessageRequestSetting(input: {
    readonly userId: string;
  }): Promise<MessageRequestSetting> {
    return instrumented(eventSink, 'readMessageRequestSetting', async () => {
      const [row] = await query(
        database,
        z.object({ setting: messageRequestSettingSchema.shape.setting }),
        sql`select setting from messaging_request_settings where user_id=${input.userId}`,
      );
      return row?.setting ?? 'everyone';
    });
  },
  writeMessageRequestSetting(input: {
    readonly userId: string;
    readonly setting: MessageRequestSetting;
  }): Promise<void> {
    return instrumented(eventSink, 'writeMessageRequestSetting', () =>
      inTransaction(database, async (tx) => {
        // The account fence every DM request takes (FOR UPDATE of the user
        // row): a request decided after this commit reads the new setting.
        await run(
          tx,
          sql`select id from users where id=${input.userId} for update`,
        );
        if (input.setting === 'everyone') {
          await run(
            tx,
            sql`delete from messaging_request_settings where user_id=${input.userId}`,
          );
          return;
        }
        await run(
          tx,
          sql`insert into messaging_request_settings(user_id,setting,updated_at)
          select u.id,${input.setting},now() from users u
          where u.id=${input.userId} and u.deleted_at is null
          on conflict (user_id) do update set setting=excluded.setting,updated_at=excluded.updated_at`,
        );
      }),
    );
  },
});
