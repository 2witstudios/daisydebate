import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import {
  messagingHttpBoundary,
  runMessagingHandler,
  unavailableMessagingHandler,
} from './handler-boundary';
import { composeMessagingGroupCreationStore } from './group-creation-composition';
import { createMessagingGroup } from './create-group';
export function composeMessagingGroupCreationRoute(app: App) {
  return (request: Request) => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social) return unavailableMessagingHandler(app, request);
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: 'messaging.group.create',
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: async (input, principal) => ({
        version: 1,
        ...(await createMessagingGroup(input, principal, {
          store: composeMessagingGroupCreationStore({
            database: app.database,
            principal,
            clock: app.clock,
            postingPolicy: policy.posting,
            readingPolicy: policy.reading,
            ...(social.groupAdmission === undefined
              ? {}
              : { creationPolicy: social.groupAdmission }),
          }),
          bounds: social.bounds,
          clock: app.clock,
          ids: app.ids,
          ...(social.groupAdmission?.state === 'approved'
            ? { policyRevision: social.groupAdmission.revision }
            : {}),
          limit: (actorId) =>
            consumeOrThrow(
              app.auth().limiter,
              `messaging:social:${actorId}`,
              social.abuse,
            ),
        })),
      }),
    });
  };
}
