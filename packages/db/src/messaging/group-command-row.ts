import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { messagingSocialCommands } from '../schema/messaging-social';
/** Only the actual caller/request row can become a group receipt result. */
export async function readMessagingGroupCommand(
  tx: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
  requestId: string,
) {
  const [row] = await tx
    .select({
      actorId: messagingSocialCommands.actorId,
      requestId: messagingSocialCommands.requestId,
      kind: messagingSocialCommands.kind,
      digest: messagingSocialCommands.digest,
      channelId: messagingSocialCommands.resultChannelId,
    })
    .from(messagingSocialCommands)
    .where(
      and(
        eq(messagingSocialCommands.actorId, actorId),
        eq(messagingSocialCommands.requestId, requestId),
      ),
    );
  return row;
}
