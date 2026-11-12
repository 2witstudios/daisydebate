import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type {
  ContextChannelFact,
  ContextChannelMetadata,
  ContextChannelReadFrame,
  ContextChannelWriteFrame,
} from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  channelHistoryView,
  channelMessageView,
  createMessagingCoreSchemas,
  idSchema,
  contentReportCreateSchema,
} from '@daisy/protocol';
import { z } from 'zod';
import type { App } from '../../../server/app';
import { parseValidated } from '../../../server/http';
import { consumeWindowsOrThrow } from '../../../server/rate-limit';
import { requireMemberActor } from '../../access/actor';
import { consumeMessagingRead } from '../handler-boundary';
import { sendMessagingMessage } from '../send';
import { mutateMessagingMessage } from '../mutate';

type Caller = { readonly userId: string; readonly actorId: string };
type ChannelScope = Caller & { readonly channelId: string };
/**
 * One owner's channel, already fenced by its context's authority for one
 * caller: the context decides who may read, post and remove.
 */
export type ContextChatStore<Fact extends ContextChannelFact> = {
  readonly discover: (caller: Caller) => Promise<ContextChannelMetadata | null>;
  readonly open: (
    caller: Caller & { readonly newChannelId: string },
  ) => Promise<ContextChannelMetadata>;
  readonly readChannel: <T>(
    scope: ChannelScope & { readonly action?: 'remove' },
    work: (frame: ContextChannelReadFrame<Fact>) => Promise<T>,
  ) => Promise<T>;
  readonly withChannel: <T>(
    scope: ChannelScope & { readonly action?: 'post' | 'remove' },
    work: (frame: ContextChannelWriteFrame<Fact>) => Promise<T>,
  ) => Promise<T>;
};
type Input = { readonly ownerId: string; readonly value: unknown };

/**
 * The operations every context chat serves: HTTP, embedded forms and history
 * all pass through the context's own fenced authority. The wire names the
 * owner under the context's field.
 */
export function contextChatOperations<Fact extends ContextChannelFact>(
  app: App,
  context: {
    readonly ownerKey: string;
    readonly store: (
      principal: AuthorizationPrincipal,
      ownerId: string,
    ) => ContextChatStore<Fact>;
    readonly metadataOf: (fact: Fact) => ContextChannelMetadata;
  },
) {
  const policy = app.messagingPolicy;
  const schemas = createMessagingCoreSchemas(policy.bounds);
  const adapter = (
    principal: AuthorizationPrincipal,
    ownerId: string,
    action: 'post' | 'remove' = 'post',
  ) => {
    const chat = context.store(principal, ownerId);
    return {
      readChannel: <T>(
        scope: ChannelScope,
        work: (frame: ContextChannelReadFrame<Fact>) => Promise<T>,
      ) =>
        chat.readChannel(
          { ...scope, ...(action === 'remove' ? { action } : {}) },
          work,
        ),
      withChannel: <T>(
        scope: ChannelScope,
        work: (frame: ContextChannelWriteFrame<Fact>) => Promise<T>,
      ) => chat.withChannel({ ...scope, action }, work),
    };
  };
  const limitSend = (actorId: string) =>
    consumeWindowsOrThrow(
      app.limiter,
      `messaging:send:${actorId}`,
      policy.limits.actorSend,
    );
  const owned = (ownerId: string) => ({
    version: 1 as const,
    [context.ownerKey]: ownerId,
  });
  const metadata = (ownerId: string, value: ContextChannelMetadata) => ({
    ...owned(ownerId),
    ...value,
  });
  const scopeOf = (channelId: string, principal: AuthorizationPrincipal) => ({
    channelId,
    ...requireMemberActor(principal),
  });
  return {
    discover: async ({ ownerId }: Input, principal: AuthorizationPrincipal) => {
      const caller = requireMemberActor(principal);
      await consumeMessagingRead(app, caller.actorId);
      const channel = await context.store(principal, ownerId).discover(caller);
      return {
        ...owned(ownerId),
        channel: channel ? metadata(ownerId, channel) : null,
      };
    },
    open: async ({ ownerId }: Input, principal: AuthorizationPrincipal) => {
      const caller = requireMemberActor(principal);
      await consumeMessagingRead(app, caller.actorId);
      return metadata(
        ownerId,
        await context
          .store(principal, ownerId)
          .open({ ...caller, newChannelId: app.ids.next() }),
      );
    },
    history: async (
      { ownerId, value }: Input,
      principal: AuthorizationPrincipal,
    ) => {
      const command = parseValidated(schemas.history, value);
      const caller = requireMemberActor(principal);
      await consumeMessagingRead(app, caller.actorId);
      return context
        .store(principal, ownerId)
        .readChannel(scopeOf(command.channelId, principal), async (frame) => {
          const page = await frame.history({
            limit: command.limit,
            ...(command.before ? { before: command.before.sequence } : {}),
          });
          return {
            ...owned(ownerId),
            metadata: metadata(ownerId, context.metadataOf(frame.fact)),
            history: schemas.viewedHistoryResult.parse({
              version: 1,
              channelId: command.channelId,
              ...page,
              messages: page.messages.map(channelHistoryView),
            }),
            authors: await frame.readAuthors([
              ...new Set(
                page.messages.flatMap((message) =>
                  message.authorActorId === null ? [] : [message.authorActorId],
                ),
              ),
            ]),
          };
        });
    },
    send: async (
      { ownerId, value }: Input,
      principal: AuthorizationPrincipal,
    ) =>
      channelMessageView(
        await sendMessagingMessage(value, principal, {
          store: adapter(principal, ownerId),
          bounds: policy.bounds,
          clock: app.clock,
          ids: app.ids,
          limit: limitSend,
        }),
      ),
    edit: async (
      { ownerId, value }: Input,
      principal: AuthorizationPrincipal,
    ) =>
      channelMessageView(
        await mutateMessagingMessage('edit', value, principal, {
          store: adapter(principal, ownerId),
          bounds: policy.bounds,
          editWindowMs: policy.editWindowMs,
          clock: app.clock,
          limit: limitSend,
        }),
      ),
    remove: async (
      { ownerId, value }: Input,
      principal: AuthorizationPrincipal,
    ) =>
      channelMessageView(
        await mutateMessagingMessage('remove', value, principal, {
          store: adapter(principal, ownerId, 'remove'),
          bounds: policy.bounds,
          editWindowMs: policy.editWindowMs,
          clock: app.clock,
          limit: limitSend,
        }),
      ),
    markRead: async (
      { ownerId, value }: Input,
      principal: AuthorizationPrincipal,
    ) => {
      const command = parseValidated(schemas.markRead, value);
      await consumeMessagingRead(app, requireMemberActor(principal).actorId);
      const sequence = await context
        .store(principal, ownerId)
        .readChannel(scopeOf(command.channelId, principal), (frame) =>
          frame.markRead(command.cursor.sequence),
        );
      return { version: 1, channelId: command.channelId, sequence };
    },
    report: async (
      { ownerId, value }: Input,
      principal: AuthorizationPrincipal,
    ) => {
      const command = parseValidated(
        z.strictObject({
          version: z.literal(1),
          channelId: idSchema,
          messageId: idSchema,
          reason: z.string(),
        }),
        value,
      );
      const report = parseValidated(contentReportCreateSchema, {
        targetKind: 'chat_message',
        targetId: command.messageId,
        reason: command.reason,
      });
      if (report.targetKind !== 'chat_message')
        throw createAppError('VALIDATION');
      const caller = requireMemberActor(principal);
      await consumeWindowsOrThrow(
        app.limiter,
        `moderation:report:${caller.userId}`,
        [{ max: 20, windowSeconds: 3600 }],
      );
      await context
        .store(principal, ownerId)
        .readChannel(scopeOf(command.channelId, principal), (frame) =>
          frame.fileReport({
            id: app.ids.next(),
            messageId: command.messageId,
            reason: report.reason,
          }),
        );
      return { received: true };
    },
  };
}
