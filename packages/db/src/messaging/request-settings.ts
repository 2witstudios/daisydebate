import type { MessageRequestSetting } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { messageRequestsFriendsOnly } from '../guardians/protection-level';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { rowsOf } from '../raw-rows';
import { scopeTransaction } from '../tenant-scope';

/**
 * A member's own "who can send me message requests" (decision 90, ADR 0160).
 * No row is everyone; choosing everyone removes the row.
 */
export const messageRequestSettingOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readMessageRequestSetting(input: {
    readonly userId: string;
  }): Promise<MessageRequestSetting> {
    return instrumented(eventSink, 'readMessageRequestSetting', async () => {
      const [row] = await rowsOf<{ setting: MessageRequestSetting }>(
        database,
        sql`select setting from messaging_request_settings where user_id=${input.userId}`,
      );
      return row?.setting ?? 'everyone';
    });
  },
  readMessageRequestPolicy({ userId }: { readonly userId: string }) {
    return instrumented(eventSink, 'readMessageRequestPolicy', () =>
      database.transaction(async (tx) => {
        await scopeTransaction(tx, { subjectUserId: userId });
        const [stored] = await rowsOf<{ setting: MessageRequestSetting }>(
          tx,
          sql`select setting from messaging_request_settings where user_id=${userId}`,
        );
        const locked = await messageRequestsFriendsOnly(tx, userId);
        const setting: MessageRequestSetting = locked
          ? 'friends'
          : (stored?.setting ?? 'everyone');
        return { setting, locked };
      }),
    );
  },
  writeMessageRequestSetting(input: {
    readonly userId: string;
    readonly setting: MessageRequestSetting;
  }): Promise<void> {
    return instrumented(eventSink, 'writeMessageRequestSetting', () =>
      database.transaction(async (tx) => {
        // The account fence every DM request takes (FOR UPDATE of the user
        // row): a request decided after this commit reads the new setting.
        await tx.execute(
          sql`select id from users where id=${input.userId} for update`,
        );
        await scopeTransaction(tx, { subjectUserId: input.userId });
        if (await messageRequestsFriendsOnly(tx, input.userId))
          throw createAppError('AUTHORIZATION');
        if (input.setting === 'everyone') {
          await tx.execute(
            sql`delete from messaging_request_settings where user_id=${input.userId}`,
          );
          return;
        }
        await tx.execute(sql`insert into messaging_request_settings(user_id,setting,updated_at)
          select u.id,${input.setting},now() from users u
          where u.id=${input.userId} and u.deleted_at is null
          on conflict (user_id) do update set setting=excluded.setting,updated_at=excluded.updated_at`);
      }),
    );
  },
});
