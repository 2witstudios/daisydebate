import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type {
  MessagingLockedFrame,
  MessagingChannelStore,
} from '@daisy/db/messaging';
import {
  createMessagingCoreSchemas,
  type MessagingCoreBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { messagingMessageView } from './message-view';
import { requireMessagingActor } from './principal';

export function createMessagingReadOperations({
  bounds,
  store,
}: {
  readonly bounds: MessagingCoreBounds;
  readonly store: MessagingChannelStore;
}) {
  const schemas = createMessagingCoreSchemas(bounds);
  const run = <T>(
    channelId: string,
    principal: AuthorizationPrincipal,
    work: (frame: MessagingLockedFrame) => Promise<T>,
  ) => {
    const identity = requireMessagingActor(principal);
    return store.withChannel({ channelId, ...identity }, work);
  };
  return {
    history(input: unknown, principal: AuthorizationPrincipal) {
      const command = parseValidated(schemas.history, input);
      return run(command.channelId, principal, async (frame) => {
        const page = await frame.history({
          limit: command.limit,
          ...(command.before === undefined
            ? {}
            : { before: command.before.sequence }),
        });
        return schemas.historyResult.parse({
          version: 1,
          channelId: command.channelId,
          ...page,
          messages: page.messages.map(messagingMessageView),
        });
      });
    },
    changes(input: unknown, principal: AuthorizationPrincipal) {
      const command = parseValidated(schemas.changes, input);
      return run(command.channelId, principal, async (frame) => {
        const { messages, ...page } = await frame.changes({
          limit: command.limit,
          after: command.after.changeVersion,
        });
        return schemas.changesResult.parse({
          version: 1,
          channelId: command.channelId,
          ...page,
          changes: messages.map((message) => ({
            kind:
              message.text === null || message.removedAt !== null
                ? 'removed'
                : message.editedAt === null
                  ? 'created'
                  : 'edited',
            channelId: message.channelId,
            messageId: message.id,
            changeVersion: message.changeVersion,
            ...(message.text === null || message.removedAt !== null
              ? {}
              : { message: messagingMessageView(message) }),
          })),
        });
      });
    },
    markRead(input: unknown, principal: AuthorizationPrincipal) {
      const command = parseValidated(schemas.markRead, input);
      return run(command.channelId, principal, async (frame) => ({
        version: 1,
        channelId: command.channelId,
        sequence: await frame.markRead(command.cursor.sequence),
      }));
    },
  };
}
