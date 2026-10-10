import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingPreferenceSchemas } from '@daisy/protocol';
import { messagingActorStates } from '../schema/messaging-channels';
import { messagingMessages } from '../schema/messaging-messages';
type Selection = {
  readonly following: boolean;
  readonly hidden: boolean;
  readonly notificationLevel: 'all' | 'mentions' | 'none';
};
const fields = {
  following: messagingActorStates.following,
  hidden: messagingActorStates.hidden,
  notificationLevel: messagingActorStates.notificationLevel,
  readSequence: messagingActorStates.readSequence,
};
/** Caller holds account/pair/channel fences. The exact operation's current read policy is mandatory. */
export function channelPreferenceFrame(
  tx: Pick<BunSQLDatabase, 'select' | 'insert'>,
  scope: { readonly channelId: string; readonly actorId: string },
  authorize: (operation: 'read' | 'update') => Promise<void>,
) {
  const selected = and(
    eq(messagingActorStates.channelId, scope.channelId),
    eq(messagingActorStates.actorId, scope.actorId),
  );
  const result = (state: unknown, unread: number) => {
    const parsed = messagingPreferenceSchemas.result.safeParse({
      version: 1,
      channelId: scope.channelId,
      state,
      unread,
    });
    if (!parsed.success) throw createAppError('INFRASTRUCTURE');
    return { state: parsed.data.state, unread: parsed.data.unread };
  };
  return {
    async read() {
      await authorize('read');
      const [state] = await tx
        .select(fields)
        .from(messagingActorStates)
        .where(selected);
      const [count] = await tx
        .select({ unread: sql<number>`count(*)::float8` })
        .from(messagingMessages)
        .where(
          and(
            eq(messagingMessages.channelId, scope.channelId),
            ne(messagingMessages.authorActorId, scope.actorId),
            isNull(messagingMessages.removedAt),
            gt(messagingMessages.sequence, state?.readSequence ?? 0),
          ),
        );
      if (!count) throw createAppError('INFRASTRUCTURE');
      return result(state ?? null, count.unread);
    },
    async update(input: Selection) {
      await authorize('update');
      const parsed = messagingPreferenceSchemas.update.safeParse({
        version: 1,
        channelId: scope.channelId,
        ...input,
      });
      if (!parsed.success) throw createAppError('VALIDATION');
      const { following, hidden, notificationLevel } = parsed.data;
      const values = { following, hidden, notificationLevel };
      const [state] = await tx
        .insert(messagingActorStates)
        .values({ ...scope, ...values, readSequence: 0 })
        .onConflictDoUpdate({
          target: [
            messagingActorStates.channelId,
            messagingActorStates.actorId,
          ],
          set: values,
        })
        .returning(fields);
      if (!state) throw createAppError('INFRASTRUCTURE');
      const saved = result(state, 0).state;
      if (!saved) throw createAppError('INFRASTRUCTURE');
      return saved;
    },
  };
}
