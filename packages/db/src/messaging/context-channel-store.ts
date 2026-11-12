import { insertContentReport } from '../content-report-write';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readAuthorizationActors } from '../authorization';
import { channelReadFrame } from './read-frame';
import {
  messagingContentFrame,
  readMessageIn,
  readReceipt,
} from './content-frame';
import { lockStream, openStream, readStream } from './stream';
import type {
  ContextChannelAction,
  ContextChannelFact,
  ContextChannelFence,
  ContextChannelOwner,
  ContextChannelReadFrame,
  ContextChannelScope,
  ContextChannelWriteFrame,
} from './context-channel-contracts';

type DiscoveryScope = Omit<ContextChannelScope, 'channelId'>;
type Transaction = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
const requireScope = (scope: DiscoveryScope) => {
  for (const id of [scope.ownerId, scope.actorId, scope.userId])
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
};

/**
 * One owning resource's channel: social pair/grant loaders never admit it.
 * Account -> owner -> channel -> stream is its global lock order, and every
 * content operation rechecks the caller's current authority under those locks.
 */
export function createContextChannelStore<Fact extends ContextChannelFact>(
  database: BunSQLDatabase,
  owner: ContextChannelOwner<Fact>,
  authorize: ContextChannelFence<Fact>,
) {
  type Frame = {
    fact: Fact;
    account: Awaited<ReturnType<typeof readAuthorizationActors>>[number];
  };
  const fenced = <T>(
    scope: DiscoveryScope,
    work: (tx: Transaction, frame: Frame) => Promise<T>,
    entryAction: 'read' | 'remove' = 'read',
  ) => {
    requireScope(scope);
    return database.transaction(async (tx) => {
      const [account] = await readAuthorizationActors(tx, [scope.actorId], {
        maxActors: 1,
      });
      if (!(await owner.fence(tx, scope.ownerId)))
        throw createAppError('NOT_FOUND');
      const fact = await owner.readFact(tx, scope.ownerId, scope.actorId);
      if (!fact) throw createAppError('NOT_FOUND');
      const frame = { fact, account: account ?? null };
      await authorize({ tx, scope, ...frame, action: entryAction });
      return work(tx, frame);
    });
  };
  const inChannel = <T>(
    scope: ContextChannelScope & { readonly action?: 'post' | 'remove' },
    write: boolean,
    work: (
      tx: Transaction,
      frame: Frame,
      counters: Awaited<ReturnType<typeof readStream>> & { channelId: string },
      check: (action: ContextChannelAction) => Promise<void>,
    ) => Promise<T>,
  ) => {
    idSchema.parse(scope.channelId);
    return fenced(
      scope,
      async (tx, frame) => {
        if (frame.fact.channelId !== scope.channelId)
          throw createAppError('NOT_FOUND');
        await tx.execute(
          sql`select id from messaging_channels where id=${scope.channelId} and kind=${owner.kind} for share`,
        );
        const counters = {
          channelId: scope.channelId,
          ...(await (write ? lockStream : readStream)(tx, scope.channelId)),
        };
        const check = async (action: ContextChannelAction) => {
          const fact = await owner.readFact(tx, scope.ownerId, scope.actorId);
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
        fact.channelId === null ? null : owner.metadataOf(fact),
      ),
    open: (scope: DiscoveryScope & { readonly newChannelId: string }) =>
      fenced(scope, async (tx, frame) => {
        if (frame.fact.channelId !== null) return owner.metadataOf(frame.fact);
        await authorize({ tx, scope, ...frame, action: 'post' });
        idSchema.parse(scope.newChannelId);
        if (
          await owner.insertChannel(tx, {
            ownerId: scope.ownerId,
            channelId: scope.newChannelId,
          })
        )
          await openStream(tx, scope.newChannelId);
        const fact = await owner.readFact(tx, scope.ownerId, scope.actorId);
        if (!fact?.channelId) throw createAppError('CONFLICT');
        return owner.metadataOf(fact);
      }),
    readChannel: <T>(
      scope: ContextChannelScope & { readonly action?: 'remove' },
      work: (frame: ContextChannelReadFrame<Fact>) => Promise<T>,
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
          readAuthors: async (authorActorIds) => {
            await check('read');
            return owner.readAuthors(tx, {
              ownerId: scope.ownerId,
              channelId: scope.channelId,
              authorActorIds,
            });
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
    withChannel: <T>(
      scope: ContextChannelScope & { readonly action?: 'post' | 'remove' },
      work: (frame: ContextChannelWriteFrame<Fact>) => Promise<T>,
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
