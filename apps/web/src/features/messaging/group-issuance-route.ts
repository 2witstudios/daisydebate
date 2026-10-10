import { createAppError } from '@daisy/errors';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';
import { messagingGroupCommandRoute } from './group-command-route';
import { composeMessagingGroupIssuanceStore } from './group-issuance-composition';
import { inviteMessagingGroup } from './group-issuance';
export function composeMessagingGroupIssuanceRoute(app: App) {
  return messagingGroupCommandRoute(
    app,
    'messaging.group.invite',
    async (input, principal, { social, limit }) => {
      const actor = requireMessagingActor(principal);
      const intent = parseValidated(
        createMessagingSocialSchemas(social.bounds).inviteGroupUsernames,
        input,
      );

      await limit(actor.actorId);
      const invitedActorIds: string[] = [];
      for (const username of intent.invitedUsernames) {
        const id = await app.database.lookupHumanActorByUsername(username);
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
