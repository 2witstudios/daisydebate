import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { messagingHttpBoundary, runMessagingHandler } from './handler-boundary';
import { composeMessagingCreationOperation } from './creation-operation';
export function composeMessagingGroupCreationRoute(app: App) {
  return (request: Request) => {
    const policy = app.messagingPolicy;
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: 'messaging.group.create',
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: async (input, principal) => ({
        version: 1,
        ...(await composeMessagingCreationOperation(app, 'private_group')(
          input,
          principal,
        )),
      }),
    });
  };
}
