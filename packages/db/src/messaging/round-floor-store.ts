import { insertContentReport } from '../content-report-write';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { roundFloorRetentionMs } from '@daisy/protocol/round-floor';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readAuthorizationActors } from '../authorization';
import { channelReadFrame } from './read-frame';
import {
  messagingContentFrame,
  readMessageIn,
  readReceipt,
} from './content-frame';
import { fenceRoundFloor, readRoundFloorFact } from './round-floor-facts';
import { lockStream, openStream, readStream } from './stream';
import type {
  RoundFloorFence,
  RoundFloorScope,
  RoundFloorReadFrame,
  RoundFloorWriteFrame,
} from './round-floor-contracts';

type DiscoveryScope = Omit<RoundFloorScope, 'channelId'>;
const requireScope = (scope: DiscoveryScope) => {
  for (const id of [scope.roundId, scope.actorId, scope.userId])
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
};
export const roundFloorMetadataOf = (
  fact: NonNullable<Awaited<ReturnType<typeof readRoundFloorFact>>>,
) => ({
  channelId: fact.channelId!,
  readOnly: fact.status === 'completed' || fact.status === 'abandoned',
  expiresAt:
    fact.completedAt === null
      ? null
      : new Date(
          Date.parse(fact.completedAt) + roundFloorRetentionMs,
        ).toISOString(),
});

/** A named contextual producer: social pair/grant loaders never admit its channel. */
export function createRoundFloorStore(
  database: BunSQLDatabase,
  authorize: RoundFloorFence,
) {
  const fenced = <T>(
    scope: DiscoveryScope,
    work: (
      tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
      frame: {
        fact: NonNullable<Awaited<ReturnType<typeof readRoundFloorFact>>>;
        account: Awaited<ReturnType<typeof readAuthorizationActors>>[number];
      },
    ) => Promise<T>,
    entryAction: 'read' | 'remove' = 'read',
  ) => {
    requireScope(scope);
    return database.transaction(async (tx) => {
      const [account] = await readAuthorizationActors(tx, [scope.actorId], {
        maxActors: 1,
      });
      if (!(await fenceRoundFloor(tx, scope.roundId)))
        throw createAppError('NOT_FOUND');
      const fact = await readRoundFloorFact(tx, scope.roundId, scope.actorId);
      if (!fact) throw createAppError('NOT_FOUND');
      const frame = { fact, account: account ?? null };
      await authorize({ tx, scope, ...frame, action: entryAction });
      return work(tx, frame);
    });
  };
  const inChannel = <T>(
    scope: RoundFloorScope & { readonly action?: 'post' | 'remove' },
    write: boolean,
    work: (
      tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
      frame: {
        fact: NonNullable<Awaited<ReturnType<typeof readRoundFloorFact>>>;
        account: Awaited<ReturnType<typeof readAuthorizationActors>>[number];
      },
      counters: Awaited<ReturnType<typeof readStream>> & { channelId: string },
      check: (action: 'read' | 'post' | 'remove') => Promise<void>,
    ) => Promise<T>,
  ) => {
    idSchema.parse(scope.channelId);
    return fenced(
      scope,
      async (tx, frame) => {
        if (frame.fact.channelId !== scope.channelId)
          throw createAppError('NOT_FOUND');
        await tx.execute(
          sql`select id from messaging_channels where id=${scope.channelId} and kind='round_floor' for share`,
        );
        const counters = {
          channelId: scope.channelId,
          ...(await (write ? lockStream : readStream)(tx, scope.channelId)),
        };
        const check = async (action: 'read' | 'post' | 'remove') => {
          const fact = await readRoundFloorFact(
            tx,
            scope.roundId,
            scope.actorId,
          );
          if (!fact || fact.channelId !== scope.channelId)
            throw createAppError('NOT_FOUND');
          await authorize({ tx, scope, ...frame, fact, action });
        };
        return work(tx, frame, counters, check);
      },
      scope.action === 'remove' ? 'remove' : 'read',
    );
  };
  return {
    discover: (scope: DiscoveryScope) =>
      fenced(scope, async (_tx, { fact }) =>
        fact.channelId === null ? null : roundFloorMetadataOf(fact),
      ),
    open: (scope: DiscoveryScope & { readonly newChannelId: string }) =>
      fenced(scope, async (tx, frame) => {
        if (frame.fact.channelId !== null)
          return roundFloorMetadataOf(frame.fact);
        await authorize({ tx, scope, ...frame, action: 'post' });
        idSchema.parse(scope.newChannelId);
        const [created] = await tx.execute(
          sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,round_id) values(${scope.newChannelId},'round_floor','round.floor',1,'active',${scope.roundId}) on conflict (round_id,kind) do nothing returning id`,
        );
        if (created) await openStream(tx, scope.newChannelId);
        const fact = await readRoundFloorFact(tx, scope.roundId, scope.actorId);
        if (!fact?.channelId) throw createAppError('CONFLICT');
        return roundFloorMetadataOf(fact);
      }),
    readFloor: <T>(
      scope: RoundFloorScope & { readonly action?: 'remove' },
      work: (frame: RoundFloorReadFrame) => Promise<T>,
    ) =>
      inChannel(scope, false, async (tx, frame, counters, check) =>
        work({
          ...frame,
          fileReport: async ({ id, messageId, reason }) => {
            await check('read');
            idSchema.parse(messageId);
            await lockStream(tx, scope.channelId);
            const message = await readMessageIn(tx, scope.channelId)(messageId);
            if (
              !message ||
              message.authorActorId === scope.actorId ||
              message.text === null ||
              message.removedAt !== null
            )
              throw createAppError('NOT_FOUND');
            await check('read');
            await insertContentReport(tx, {
              id,
              reporterUserId: scope.userId,
              report: {
                targetKind: 'chat_message',
                targetId: messageId,
                reason,
              },
              feedbackSide: null,
            });
          },
          readAuthors: async () => {
            await check('read');
            const rows = await tx.execute(
              sql`select distinct a.id as "actorId",u.username as label from messaging_messages m join actors a on a.id=m.author_actor_id and a.kind='human' join users u on u.id=a.user_id and u.deleted_at is null join rounds r on r.id=${scope.roundId} left join round_participants p on p.round_id=r.id and p.actor_id=a.id where m.channel_id=${scope.channelId} and m.text is not null and m.removed_at is null and (p.role in ('affirmative','negative') or (p.role is null and r.created_by_actor_id=a.id)) order by a.id`,
            );
            return rows as unknown as readonly {
              readonly actorId: string;
              readonly label: string;
            }[];
          },
          authorize: () => check('read'),
          ...channelReadFrame(tx, scope, counters, () => check('read')),
          async readRequestState({ requestId, messageId }) {
            await check(scope.action === 'remove' ? 'remove' : 'read');
            idSchema.parse(requestId);
            if (messageId !== undefined) idSchema.parse(messageId);
            const message = await readMessageIn(
              tx,
              scope.channelId,
            )(messageId ?? null);
            if (
              scope.action === 'remove' &&
              (!message || message.authorActorId !== scope.actorId)
            )
              throw createAppError('NOT_FOUND');
            return {
              counters,
              receipt: await readReceipt(tx, scope, requestId),
              message,
            };
          },
        }),
      ),
    withFloor: <T>(
      scope: RoundFloorScope & { readonly action?: 'post' | 'remove' },
      work: (frame: RoundFloorWriteFrame) => Promise<T>,
    ) =>
      inChannel(scope, true, async (tx, frame, counters, check) => {
        const content = messagingContentFrame(tx, scope, counters, () =>
          check(scope.action ?? 'post'),
        );
        return work({
          ...frame,
          ...content,
          ...channelReadFrame(tx, scope, counters, () => check('read')),
          authorize: () => check('post'),
          readSendState: async (command) => {
            await check('post');
            return content.readSendState(command);
          },
          commitSend: async (plan) => {
            await check('post');
            return content.commitSend(plan);
          },
          readMutationState: async (command) => {
            if (command.kind !== 'remove' || scope.action !== 'remove')
              await check('post');
            const state = await content.readMutationState(command);
            if (
              scope.action === 'remove' &&
              (!state.message || state.message.authorActorId !== scope.actorId)
            )
              throw createAppError('NOT_FOUND');
            return state;
          },
        });
      }),
  };
}
