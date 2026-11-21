import { invalidateMessagingInboxes } from './inbox-change';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingDmPairs,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { contactPairs } from '../schema/contacts';
import { spendSocialRequest } from '../contacts/request-budget';
import { advanceSocialChannelAuthority } from './social-channel-change';
import { openStream } from './stream';
import type { ContactInput } from '../contacts/fence';
import type { MessagingSocialFrame } from './social-contracts';
import type { ContactReactions } from '../contacts/reactions';
import { oweNotifications, resurfaceNotifications } from '../notifications/owe';
import { rowsOf } from '../raw-rows';
import { sql } from 'drizzle-orm';
type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
type Pair = typeof contactPairs.$inferSelect;

/** Pair fence is already held; all counts share the initiating account fence. */
export function dmRequestFrame(
  tx: Tx,
  input: ContactInput,
  rows: readonly Pair[],
  authorize: () => Promise<void>,
  relations: ContactReactions['relations'],
): Pick<
  MessagingSocialFrame,
  'readDmRequest' | 'commitDmRequest' | 'screenDmRequest'
> {
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
  const converges = (current: Awaited<ReturnType<typeof read>>) =>
    current !== null && ['pending', 'accepted'].includes(current.requestState);
  const canReopen = (current: NonNullable<Awaited<ReturnType<typeof read>>>) =>
    current.requestState === 'declined' || current.requestState === 'cancelled';
  const activeChannel = async (channelId: string) => {
    const [channel] = await tx
      .select()
      .from(messagingChannels)
      .where(eq(messagingChannels.id, channelId))
      .for('update');
    if (!channel || channel.lifecycle !== 'active')
      throw createAppError('AUTHORIZATION');
    return channel;
  };
  return {
    // An existing pending or accepted DM is no new request: asking again
    // converges on it without spending DEC-251's budgets or writing a ledger
    // row (the convergence is idempotent, so no receipt is needed).
    async screenDmRequest() {
      await authorize();
      const current = await read();
      if (current && converges(current))
        return { channelId: current.channelId, state: current.requestState };
      if (current) {
        if (!canReopen(current)) throw createAppError('AUTHORIZATION');
        await activeChannel(current.channelId);
      }
      return null;
    },
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
      // screenDmRequest owns convergence: a pending or accepted DM is no new
      // request, so committing one is a caller that skipped the screen.
      if (current && !canReopen(current)) throw createAppError('CONFLICT');
      const record = await spendSocialRequest(
        tx,
        {
          actorId: input.actorId,
          counterpartActorId: counterpartOf(input),
          kind: 'dm',
          requestId: command.requestId,
          now: command.now,
          limits: command.limits,
        },
        relations,
      );
      const pair = rows[0]!;
      const channelId = current?.channelId ?? command.channelId;
      if (current) {
        await advanceSocialChannelAuthority(tx, await activeChannel(channelId));
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
        });
        await openStream(tx, channelId);
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
      }
      await record();
      // The recipient hears of it in-app (and in their digest) in the same
      // transaction; the introduction itself stays in Messages (decision 90).
      const recipients = await rowsOf<{ user_id: string }>(
        tx,
        sql`select user_id from actors where id=${counterpartOf(input)} and user_id is not null`,
      );
      const owed = {
        kind: 'dm_request' as const,
        subject: { dm_channel_id: channelId },
        at: command.now,
        nextId: command.nextId,
      };
      const written = await oweNotifications(tx, {
        ...owed,
        recipients: recipients.map((row) => ({
          userId: row.user_id,
          about: input.actorId,
        })),
      });
      // Asking again after a decline brings the earlier notice back unread.
      if (written === 0)
        await resurfaceNotifications(tx, {
          ...owed,
          userIds: recipients.map((row) => row.user_id),
        });
      // Messaging's own receipt, which a retry of this request replays.
      await tx.insert(messagingSocialCommands).values({
        actorId: input.actorId,
        requestId: command.requestId,
        counterpartActorId: counterpartOf(input),
        kind: 'dm.request',
        digest: command.digest,
        resultChannelId: channelId,
        createdAt: new Date(command.now),
      });
      return { channelId, state: 'pending' };
    },
  };
}
function counterpartOf(input: ContactInput) {
  const counterpartActorId = input.memberActorIds.find(
    (actorId) => actorId !== input.actorId,
  );
  if (!counterpartActorId) throw createAppError('VALIDATION');
  return counterpartActorId;
}
