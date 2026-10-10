import { createAppError } from '@daisy/errors';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import { requireMessagingActor } from './principal';
import {
  messagingHttpBoundary,
  runMessagingHandler,
  unavailableMessagingHandler,
} from './handler-boundary';
import { composeMessagingGroupManagementStore } from './group-management-composition';
import { manageMessagingGroup } from './group-management';
export function composeMessagingGroupManagementRoute(app: App) {
  return (request: Request) => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social) return unavailableMessagingHandler(app, request);
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: 'messaging.group.manage',
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: async (input, principal) => {
        const actor = requireMessagingActor(principal);
        const intent = parseValidated(
          createMessagingSocialSchemas(social.bounds).manageGroupUsername,
          input,
        );
        const limit = (actorId: string) =>
          consumeOrThrow(
            app.auth().limiter,
            `messaging:social:${actorId}`,
            social.abuse,
          );
        let target: string | null = null;
        if ('memberUsername' in intent) {
          await limit(actor.actorId);
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
    });
  };
}
