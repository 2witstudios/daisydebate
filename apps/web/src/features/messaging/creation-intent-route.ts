import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import {
  runMessagingHandler,
  messagingHttpBoundary,
  unavailableMessagingHandler,
} from './handler-boundary';
import { resolveMessagingCreationIntent } from './creation-intent';
import { composeMessagingCreationOperation } from './creation-operation';
import { composeMessagingBlockOperation } from './block-composition';
export function composeMessagingCreationIntentRoutes(app: App) {
  const run = (request: Request, kind: 'dm' | 'private_group' | 'block') => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social) return unavailableMessagingHandler(app, request);
    const schemas = createMessagingSocialSchemas(social.bounds);
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: `messaging.${kind}.username`,
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: async (input, principal) => {
        const block =
          kind === 'block'
            ? parseValidated(schemas.blockUsername, input)
            : null;
        const command = await resolveMessagingCreationIntent(
          kind === 'block' ? 'dm' : kind,
          block
            ? {
                version: block.version,
                requestId: block.requestId,
                recipientUsername: block.recipientUsername,
              }
            : input,
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
        const result =
          kind === 'block' && block
            ? await composeMessagingBlockOperation(app)(
                {
                  version: block.version,
                  requestId: block.requestId,
                  otherActorId:
                    'recipientActorId' in command
                      ? command.recipientActorId
                      : undefined,
                  blocked: block.blocked,
                },
                principal,
              )
            : await composeMessagingCreationOperation(
                app,
                kind === 'block' ? 'dm' : kind,
              )(command, principal);
        return (
          kind === 'block'
            ? schemas.blockResult
            : kind === 'dm'
              ? schemas.dmResult
              : schemas.groupResult
        ).parse({ version: 1, ...result });
      },
    });
  };
  return {
    blockByUsername: (request: Request) => run(request, 'block'),
    requestByUsername: (request: Request) => run(request, 'dm'),
    createGroupByUsername: (request: Request) => run(request, 'private_group'),
  };
}
