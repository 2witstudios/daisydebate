import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type {
  MessagingLockedFrame,
  MessagingChannelStore,
  MessagingReadFrame,
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
  // Reads take shared fences; only the read marker writes (MSG-2.1-arch1).
  const read = <T>(
    channelId: string,
    principal: AuthorizationPrincipal,
    work: (frame: MessagingReadFrame) => Promise<T>,
  ) =>
    store.readChannel({ channelId, ...requireMessagingActor(principal) }, work);
  const write = <T>(
    channelId: string,
    principal: AuthorizationPrincipal,
    work: (frame: MessagingLockedFrame) => Promise<T>,
  ) =>
    store.withChannel({ channelId, ...requireMessagingActor(principal) }, work);
  const history = (
    command: {
      channelId: string;
      limit: number;
      before?: { sequence: number } | undefined;
      query?: string | undefined;
    },
    principal: AuthorizationPrincipal,
  ) =>
    read(command.channelId, principal, async (frame) => {
      const page = await frame.history({
        limit: command.limit,
        ...(command.before === undefined
          ? {}
          : { before: command.before.sequence }),
        ...(command.query === undefined ? {} : { query: command.query }),
      });
      return schemas.historyResult.parse({
        version: 1,
        channelId: command.channelId,
        ...page,
        messages: page.messages.map(messagingMessageView),
      });
    });
  return {
    history: (input: unknown, principal: AuthorizationPrincipal) =>
      history(parseValidated(schemas.history, input), principal),
    search: (input: unknown, principal: AuthorizationPrincipal) =>
      history(parseValidated(schemas.search, input), principal),
    changes(input: unknown, principal: AuthorizationPrincipal) {
      const command = parseValidated(schemas.changes, input);
      return read(command.channelId, principal, async (frame) => {
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
      return write(command.channelId, principal, async (frame) => ({
        version: 1,
        channelId: command.channelId,
        sequence: await frame.markRead(command.cursor.sequence),
      }));
    },
  };
}
