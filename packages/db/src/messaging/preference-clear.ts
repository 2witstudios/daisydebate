import { invalidateMessagingInboxes } from './inbox-change';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import { messagingActorStates } from '../schema/messaging-channels';
type Scope = {
  readonly actorId: string;
  readonly channelId: string;
  readonly userId: string;
};
export type MessagingPreferenceClearFence = (
  tx: AuthorizationTransaction,
  scope: Scope,
  frame: {
    readonly accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>;
    readonly fact: {
      readonly kind: 'channel_preference';
      readonly actorId: string;
      readonly channelId: string;
    } | null;
  },
) => Promise<void>;
/** Clear affects only an existing own preference. Account fencing serializes erasure; no channel/content grant is acquired. */
export async function clearOwnMessagingPreference(
  tx: Pick<BunSQLDatabase, 'execute' | 'insert' | 'select' | 'delete'>,
  scope: Scope,
  authorize: MessagingPreferenceClearFence,
) {
  for (const id of Object.values(scope))
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  const accounts = await lockAuthorizationActors(tx, [scope.actorId], {
    maxActors: 1,
  });
  const selected = and(
    eq(messagingActorStates.channelId, scope.channelId),
    eq(messagingActorStates.actorId, scope.actorId),
  );
  const [row] = await tx
    .select({
      actorId: messagingActorStates.actorId,
      channelId: messagingActorStates.channelId,
    })
    .from(messagingActorStates)
    .where(selected)
    .for('update');
  await authorize(tx, scope, {
    accounts,
    fact: row ? { kind: 'channel_preference', ...row } : null,
  });
  if (!row) return false;
  await tx.delete(messagingActorStates).where(selected);
  await invalidateMessagingInboxes(tx, [scope.actorId]);
  return true;
}
