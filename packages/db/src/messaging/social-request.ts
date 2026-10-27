import { invalidateMessagingInboxes } from './inbox-change';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic } from '@daisy/protocol';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingContactPairs,
  messagingDmPairs,
} from '../schema/messaging-social';
import { spendSocialRequest } from './social-request-budget';
import { appendOutboxEvent } from '../outbox';
import { advanceSocialChannelAuthority } from './social-channel-change';
import type {
  MessagingSocialFrame,
  MessagingSocialInput,
} from './social-contracts';
type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
type Pair = typeof messagingContactPairs.$inferSelect;

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
      // An existing pending or accepted DM is no new request: asking again
      // converges on it without spending DEC-251's budgets or writing a
      // ledger row (the convergence is idempotent, so no receipt is needed).
      if (current && ['pending', 'accepted'].includes(current.requestState))
        return { channelId: current.channelId, state: current.requestState };
      const record = await spendSocialRequest(tx, {
        actorId: input.actorId,
        counterpartActorId: counterpartOf(input),
        kind: 'dm.request',
        requestId: command.requestId,
        digest: command.digest,
        now: command.now,
        limits: command.limits,
      });
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
        await invalidateMessagingInboxes(tx, [
          pair.lowActorId,
          pair.highActorId,
        ]);
        await appendOutboxEvent(tx, {
          topic: buildChannelTopic(channelId),
          kind: 'channel.changed',
          version: 1,
          payload: { kind: 'channel.changed', channelId, changeVersion: 1 },
        });
      }
      await record(channelId);
      return { channelId, state: 'pending' };
    },
  };
}
function counterpartOf(input: MessagingSocialInput) {
  const counterpartActorId = input.memberActorIds.find(
    (actorId) => actorId !== input.actorId,
  );
  if (!counterpartActorId) throw createAppError('VALIDATION');
  return counterpartActorId;
}
