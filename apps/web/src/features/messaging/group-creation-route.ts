import type { App } from '../../server/app';
import { readJson } from '../../server/http';

import { composeMessagingCreationOperation } from './creation-operation';
import {
  memberHttpBoundary,
  runMemberHandler,
} from '../../server/member-handler';
export function composeMessagingGroupCreationRoute(app: App) {
  return (request: Request) => {
    const policy = app.messagingPolicy;
    return runMemberHandler(memberHttpBoundary(app), request, {
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
