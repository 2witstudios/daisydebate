import { createAppError } from '@daisy/errors';
import { spendUsernameDiscovery } from '../account/username-discovery';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated } from '../../server/http';

import { messagingGroupCommandRoute } from './group-command-route';
import { composeMessagingGroupManagementStore } from './group-management-composition';
import { manageMessagingGroup } from './group-management';
import { requireMemberActor } from '../access/actor';
export function composeMessagingGroupManagementRoute(app: App) {
  return messagingGroupCommandRoute(
    app,
    'messaging.group.manage',
    async (input, principal, { policy, social, limit }) => {
      const actor = requireMemberActor(principal);
      const intent = parseValidated(
        createMessagingSocialSchemas(social.bounds).manageGroupUsername,
        input,
      );

      let target: string | null = null;
      if ('memberUsername' in intent) {
        await limit(actor.actorId);
        await spendUsernameDiscovery(app.limiter, actor.actorId);
        target = await app.database.lookupHumanActorByUsername(
          intent.memberUsername,
        );
        if (target === null) throw createAppError('AUTHORIZATION');
      }
      const command = {
        version: 1,
        requestId: intent.requestId,
        channelId: intent.channelId,
        ...(intent.operation === 'remove'
          ? { memberActorId: target }
          : intent.operation === 'transfer'
            ? { managerActorId: target }
            : {}),
      };
      return manageMessagingGroup(intent.operation, command, principal, {
        store: composeMessagingGroupManagementStore({
          database: app.database,
          principal,
          clock: app.clock,
          postingPolicy: policy.groupPosting ?? policy.posting,
          readingPolicy: policy.reading,
        }),
        bounds: social.bounds,
        clock: app.clock,
        limit,
      });
    },
  );
}
