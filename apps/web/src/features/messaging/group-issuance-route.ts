import { createAppError } from '@daisy/errors';
import { appDiscoverActor } from '../account/username-discovery';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated } from '../../server/http';

import { messagingGroupCommandRoute } from './group-command-route';
import { composeMessagingGroupIssuanceStore } from './group-issuance-composition';
import { inviteMessagingGroup } from './group-issuance';
import { requirePrivateGroups } from './private-groups';
import { requireMemberActor } from '../access/actor';
export function composeMessagingGroupIssuanceRoute(app: App) {
  return messagingGroupCommandRoute(
    app,
    'messaging.group.invite',
    async (input, principal, { policy, social, limit }) => {
      requirePrivateGroups(policy);
      const actor = requireMemberActor(principal);
      const intent = parseValidated(
        createMessagingSocialSchemas(social.bounds).inviteGroupUsernames,
        input,
      );

      await limit(actor.actorId);
      const discover = appDiscoverActor(app);
      const invitedActorIds: string[] = [];
      for (const username of intent.invitedUsernames) {
        const id = await discover(actor.actorId, username);
        if (id === null) throw createAppError('AUTHORIZATION');
        invitedActorIds.push(id);
      }
      return inviteMessagingGroup(
        {
          version: 1,
          requestId: intent.requestId,
          channelId: intent.channelId,
          invitedActorIds,
        },
        principal,
        {
          store: composeMessagingGroupIssuanceStore({
            database: app.database,
            principal,
            clock: app.clock,
            policy: social.groupAdmission,
          }),
          bounds: social.bounds,
          clock: app.clock,
          limits: social.groupInvitationLimits,
          limit,
        },
      );
    },
  );
}
