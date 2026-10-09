import type { App } from '../../server/app';
import { createMessagingInboxSchemas } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { parseValidated } from '../../server/http';
import {
  runMessagingHandler,
  messagingHttpBoundary,
  unavailableMessagingHandler,
} from './handler-boundary';
import { composeMessagingInbox } from './inbox-composition';
export function composeMessagingInboxRoute(app: App) {
  return (request: Request) => {
    const policy = app.messagingPolicy;
    if (!policy)
      return unavailableMessagingHandler(
        app,
        request,
        'messaging.inbox.unavailable',
      );
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
        const result = await composeMessagingInbox({
          database: app.database,
          principal,
          clock: app.clock,
          postingPolicy: policy.posting,
          readingPolicy: policy.reading,
        }).read({
          limit: policy.bounds.pageItems,
          ...(query.after === undefined ? {} : { after: query.after }),
        });
        return schemas.result.parse({ version: 1, ...result });
      },
    });
  };
}
