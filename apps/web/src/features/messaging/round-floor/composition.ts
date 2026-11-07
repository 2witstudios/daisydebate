import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { decideRoundFloor } from '@daisy/auth/round-floor';
import {
  roundFloorMetadataOf,
  type RoundFloorReadFrame,
  type RoundFloorWriteFrame,
  type RoundFloorScope,
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
import { memberHttpBoundary } from '../../../server/member-boundary';
import { parseValidated } from '../../../server/http';
import { consumeWindowsOrThrow } from '../../../server/rate-limit';
import { requireMemberActor } from '../../access/actor';
import { consumeMessagingRead } from '../handler-boundary';
import { sendMessagingMessage } from '../send';
import { mutateMessagingMessage } from '../mutate';
import { createFloorHandlers } from './handlers';

/** HTTP, embedded forms and retained history all use the same fenced Round authority. */
export function composeRoundFloorRoutes(app: App) {
  const policy = app.messagingPolicy;
  const schemas = createMessagingCoreSchemas(policy.bounds);
  const store = (principal: AuthorizationPrincipal) => {
    const caller = requireMemberActor(principal);
    return app.database.roundFloorStore(
      async ({ scope, fact, account, action }) => {
        const bound =
          scope.userId === caller.userId && scope.actorId === caller.actorId;
        const decision = decideRoundFloor({
          principal: caller,
          fact,
          account,
          action,
          now: app.clock.now(),
        });
        if (!bound || !decision.allow)
          throw createAppError(
            action === 'post' ? 'AUTHORIZATION' : 'NOT_FOUND',
          );
      },
    );
  };
  const adapter = (
    principal: AuthorizationPrincipal,
    roundId: string,
    action: 'post' | 'remove' = 'post',
  ) => {
    const floor = store(principal);
    return {
      readChannel: <T>(
        scope: Omit<RoundFloorScope, 'roundId'>,
        work: (frame: RoundFloorReadFrame) => Promise<T>,
      ) =>
        floor.readFloor(
          { ...scope, roundId, ...(action === 'remove' ? { action } : {}) },
          work,
        ),
      withChannel: <T>(
        scope: Omit<RoundFloorScope, 'roundId'>,
        work: (frame: RoundFloorWriteFrame) => Promise<T>,
      ) => floor.withFloor({ ...scope, roundId, action }, work),
    };
  };
  const limitSend = (actorId: string) =>
    consumeWindowsOrThrow(
      app.limiter,
      `messaging:send:${actorId}`,
      policy.limits.actorSend,
    );
  const metadata = (
    roundId: string,
    value: { channelId: string; readOnly: boolean; expiresAt: string | null },
  ) => ({ version: 1 as const, roundId, ...value });
  const scopeOf = (
    roundId: string,
    channelId: string,
    principal: AuthorizationPrincipal,
  ) => ({ roundId, channelId, ...requireMemberActor(principal) });
  return createFloorHandlers({
    ...memberHttpBoundary(app),
    maxBodyBytes: policy.maxBodyBytes,
    bounds: policy.bounds,
    websocketEndpoint: app.websocketEndpoint,
    operations: {
      discover: async ({ roundId }, principal) => {
        const caller = requireMemberActor(principal);
        await consumeMessagingRead(app, caller.actorId);
        const channel = await store(principal).discover({ roundId, ...caller });
        return {
          version: 1,
          roundId,
          channel: channel ? metadata(roundId, channel) : null,
        };
      },
      open: async ({ roundId }, principal) => {
        const caller = requireMemberActor(principal);
        await consumeMessagingRead(app, caller.actorId);
        return metadata(
          roundId,
          await store(principal).open({
            roundId,
            ...caller,
            newChannelId: app.ids.next(),
          }),
        );
      },
      history: async ({ roundId, value }, principal) => {
        const command = parseValidated(schemas.history, value);
        const caller = requireMemberActor(principal);
        await consumeMessagingRead(app, caller.actorId);
        return store(principal).readFloor(
          scopeOf(roundId, command.channelId, principal),
          async (frame) => {
            const page = await frame.history({
              limit: command.limit,
              ...(command.before ? { before: command.before.sequence } : {}),
            });
            return {
              version: 1,
              roundId,
              metadata: metadata(roundId, roundFloorMetadataOf(frame.fact)),
              history: schemas.viewedHistoryResult.parse({
                version: 1,
                channelId: command.channelId,
                ...page,
                messages: page.messages.map(channelHistoryView),
              }),
              authors: await frame.readAuthors(),
            };
          },
        );
      },
      send: async ({ roundId, value }, principal) =>
        channelMessageView(
          await sendMessagingMessage(value, principal, {
            store: adapter(principal, roundId),
            bounds: policy.bounds,
            clock: app.clock,
            ids: app.ids,
            limit: limitSend,
          }),
        ),
      edit: async ({ roundId, value }, principal) =>
        channelMessageView(
          await mutateMessagingMessage('edit', value, principal, {
            store: adapter(principal, roundId),
            bounds: policy.bounds,
            editWindowMs: policy.editWindowMs,
            clock: app.clock,
            limit: limitSend,
          }),
        ),
      remove: async ({ roundId, value }, principal) =>
        channelMessageView(
          await mutateMessagingMessage('remove', value, principal, {
            store: adapter(principal, roundId, 'remove'),
            bounds: policy.bounds,
            editWindowMs: policy.editWindowMs,
            clock: app.clock,
            limit: limitSend,
          }),
        ),
      markRead: async ({ roundId, value }, principal) => {
        const command = parseValidated(schemas.markRead, value);
        await consumeMessagingRead(app, requireMemberActor(principal).actorId);
        const sequence = await store(principal).readFloor(
          scopeOf(roundId, command.channelId, principal),
          (frame) => frame.markRead(command.cursor.sequence),
        );
        return { version: 1, channelId: command.channelId, sequence };
      },
      report: async ({ roundId, value }, principal) => {
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
        await store(principal).readFloor(
          scopeOf(roundId, command.channelId, principal),
          (frame) =>
            frame.fileReport({
              id: app.ids.next(),
              messageId: command.messageId,
              reason: report.reason,
            }),
        );
        return { received: true };
      },
    },
  });
}
