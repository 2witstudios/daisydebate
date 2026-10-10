import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import {
  runMessagingHandler,
  messagingHttpBoundary,
  unavailableMessagingHandler,
} from './handler-boundary';
import { resolveMessagingCreationIntent } from './creation-intent';
import { composeMessagingCreationOperation } from './creation-operation';
export function composeMessagingCreationIntentRoutes(app: App) {
  const run = (request: Request, kind: 'dm' | 'private_group') => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social) return unavailableMessagingHandler(app, request);
    const schemas = createMessagingSocialSchemas(social.bounds);
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: `messaging.${kind}.username`,
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: async (input, principal) => {
        const command = await resolveMessagingCreationIntent(
          kind,
          input,
          principal,
          {
            bounds: social.bounds,
            lookup: (username) =>
              app.database.lookupHumanActorByUsername(username),
            limit: (actorId) =>
              consumeOrThrow(
                app.auth().limiter,
                `messaging:discovery:${actorId}`,
                social.abuse,
              ),
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
