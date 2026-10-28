import { requirePrivateGroups } from './private-groups';
import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { spendUsernameDiscovery } from '../access/username-discovery';
import { createMessagingSocialSchemas } from '@daisy/protocol';

import { resolveMessagingCreationIntent } from './creation-intent';
import { composeMessagingCreationOperation } from './creation-operation';
import {
  memberHttpBoundary,
  runMemberHandler,
} from '../../server/member-handler';
export function composeMessagingCreationIntentRoutes(app: App) {
  const run = (request: Request, kind: 'dm' | 'private_group') => {
    const policy = app.messagingPolicy,
      social = policy.social;
    const schemas = createMessagingSocialSchemas(social.bounds);
    return runMemberHandler(memberHttpBoundary(app), request, {
      name: `messaging.${kind}.username`,
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: async (input, principal) => {
        // Before any username lookup or limiter: groups are off (ISSUE-643).
        if (kind === 'private_group') requirePrivateGroups(policy);
        const command = await resolveMessagingCreationIntent(
          kind,
          input,
          principal,
          {
            bounds: social.bounds,
            lookup: (username) =>
              app.database.lookupHumanActorByUsername(username),
            limit: (actorId) =>
              spendUsernameDiscovery(app.limiter, actorId, social.abuse),
          },
        );
        const result = await composeMessagingCreationOperation(app, kind)(
          command,
          principal,
        );
        return (kind === 'dm' ? schemas.dmResult : schemas.groupResult).parse({
          version: 1,
          ...result,
        });
      },
    });
  };
  return {
    requestByUsername: (request: Request) => run(request, 'dm'),
    createGroupByUsername: (request: Request) => run(request, 'private_group'),
  };
}
