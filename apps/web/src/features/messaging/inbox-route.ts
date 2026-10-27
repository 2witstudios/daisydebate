import type { App } from '../../server/app';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createMessagingInboxSchemas, idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { parseValidated } from '../../server/http';
import { runMessagingHandler, messagingHttpBoundary } from './handler-boundary';
import { composeMessagingInbox } from './inbox-composition';
const inboxOf = (app: App, principal: AuthorizationPrincipal) =>
  composeMessagingInbox({
    database: app.database,
    principal,
    clock: app.clock,
    postingPolicy: app.messagingPolicy.posting,
    readingPolicy: app.messagingPolicy.reading,
  });

/** One conversation's inbox entry: its title and kind for its page (ISSUE-605). */
export function composeMessagingChannelEntryRoute(app: App) {
  return (request: Request, channelId: string) => {
    const schemas = createMessagingInboxSchemas(
      app.messagingPolicy.bounds.pageItems,
    );
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: 'messaging.channel.entry',
      readOnly: true,
      readInput: async () => parseValidated(idSchema, channelId),
      operation: async (value, principal) =>
        schemas.entry.parse({
          version: 1,
          entry: await inboxOf(app, principal).entry(
            parseValidated(idSchema, value),
          ),
        }),
    });
  };
}

export function composeMessagingInboxRoute(app: App) {
  return (request: Request) => {
    const policy = app.messagingPolicy;
    const schemas = createMessagingInboxSchemas(policy.bounds.pageItems);
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: 'messaging.inbox',
      readOnly: true,
      headers: {
        'x-messaging-page-items': String(policy.bounds.pageItems),
        ...(app.websocketEndpoint
          ? { 'x-realtime-socket-url': app.websocketEndpoint }
          : {}),
      },
      readInput: async () => {
        const params = new URL(request.url).searchParams;
        if (
          [...params.keys()].some((key) => key !== 'after') ||
          params.getAll('after').length > 1
        )
          throw createAppError('VALIDATION');
        const after = params.get('after');
        return parseValidated(schemas.query, {
          version: 1,
          ...(after === null ? {} : { after }),
        });
      },
      operation: async (value, principal) => {
        const query = parseValidated(schemas.query, value);
        const result = await inboxOf(app, principal).read({
          limit: policy.bounds.pageItems,
          ...(query.after === undefined ? {} : { after: query.after }),
        });
        return schemas.result.parse({ version: 1, ...result });
      },
    });
  };
}
