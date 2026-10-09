import { and, eq, gte, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic } from '@daisy/protocol';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingContactPairs,
  messagingDmPairs,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { appendOutboxEvent } from '../outbox';
import { advanceSocialChannelAuthority } from './social-channel-change';
import type {
  MessagingSocialFrame,
  MessagingSocialInput,
} from './social-contracts';
type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
type Pair = typeof messagingContactPairs.$inferSelect;
type RequestCommand = Parameters<MessagingSocialFrame['commitDmRequest']>[0];

/** Pair fence is already held; all counts share the initiating account fence. */
export function dmRequestFrame(
  tx: Tx,
  input: MessagingSocialInput,
  rows: readonly Pair[],
  authorize: () => Promise<void>,
): Pick<MessagingSocialFrame, 'readDmRequest' | 'commitDmRequest'> {
  const read = async () => {
    if (rows.length !== 1) throw createAppError('VALIDATION');
    const pair = rows[0]!;
    const [current] = await tx
      .select()
      .from(messagingDmPairs)
      .where(
        and(
          eq(messagingDmPairs.lowActorId, pair.lowActorId),
          eq(messagingDmPairs.highActorId, pair.highActorId),
        ),
      );
    return current ?? null;
  };
  return {
    async readDmRequest() {
      await authorize();
      const current = await read();
      return current
        ? { channelId: current.channelId, state: current.requestState }
        : null;
    },
    async commitDmRequest(command) {
      await authorize();
      if (command.policyRevision !== input.policyRevision)
        throw createAppError('CONFLICT');
      const current = await read();
      if (current && ['pending', 'accepted'].includes(current.requestState)) {
        await recordRequest(tx, input.actorId, command, current.channelId);
        return { channelId: current.channelId, state: current.requestState };
      }
      await enforceRequestLimits(tx, input.actorId, command, current);
      const pair = rows[0]!;
      const channelId = current?.channelId ?? command.channelId;
      if (current) {
        const [channel] = await tx
          .select()
          .from(messagingChannels)
          .where(eq(messagingChannels.id, channelId))
          .for('update');
        if (!channel || channel.lifecycle !== 'active')
          throw createAppError('AUTHORIZATION');
        await advanceSocialChannelAuthority(tx, channel);
        await tx
          .update(messagingDmPairs)
          .set({
            requestSenderActorId: input.actorId,
            requestState: 'pending',
            introduction: command.introduction,
            requestedAt: new Date(command.now),
            decidedAt: null,
          })
          .where(eq(messagingDmPairs.channelId, channelId));
      } else {
        await tx.insert(messagingChannels).values({
          id: channelId,
          kind: 'dm',
          policyKey: 'social.dm',
          policyRevision: command.policyRevision,
          lifecycle: 'active',
          createdAt: new Date(command.now),
          changeVersion: 1,
        });
        await tx.insert(messagingDmPairs).values({
          lowActorId: pair.lowActorId,
          highActorId: pair.highActorId,
          channelId,
          requestSenderActorId: input.actorId,
          requestState: 'pending',
          introduction: command.introduction,
          requestedAt: new Date(command.now),
        });
        await appendOutboxEvent(tx, {
          topic: buildChannelTopic(channelId),
          kind: 'channel.changed',
          version: 1,
          payload: { kind: 'channel.changed', channelId, changeVersion: 1 },
        });
      }
      await recordRequest(tx, input.actorId, command, channelId);
      return { channelId, state: 'pending' };
    },
  };
}
async function recordRequest(
  tx: Tx,
  actorId: string,
  command: RequestCommand,
  channelId: string,
) {
  await tx.insert(messagingSocialCommands).values({
    actorId,
    requestId: command.requestId,
    kind: 'dm.request',
    digest: command.digest,
    resultChannelId: channelId,
    createdAt: new Date(command.now),
  });
}
async function enforceRequestLimits(
  tx: Tx,
  actorId: string,
  command: RequestCommand,
  current: typeof messagingDmPairs.$inferSelect | null,
) {
  const now = Date.parse(command.now),
    limits = command.limits;
  if (
    !Number.isFinite(now) ||
    !Object.values(limits).every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw createAppError('VALIDATION');
  if (
    current?.decidedAt &&
    now - current.decidedAt.getTime() < limits.cooldownMs
  )
    throw createAppError('RATE_LIMIT');
  const sender = eq(messagingDmPairs.requestSenderActorId, actorId);
  const [counts] = await tx
    .select({
      pending: sql<number>`count(*) filter(where ${messagingDmPairs.requestState}='pending')::int`,
      recent: sql<number>`count(*) filter(where ${messagingDmPairs.requestedAt} > ${new Date(now - limits.windowMs)})::int`,
    })
    .from(messagingDmPairs)
    .where(
      and(
        sender,
        or(
          eq(messagingDmPairs.requestState, 'pending'),
          gte(messagingDmPairs.requestedAt, new Date(now - limits.windowMs)),
        ),
      ),
    );
  if (
    !counts ||
    counts.pending >= limits.maxPending ||
    counts.recent >= limits.maxNewPairs
  )
    throw createAppError('RATE_LIMIT');
}
