import { messagingPreferenceSchemas } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import {
  runMessagingHandler,
  messagingHttpBoundary,
  unavailableMessagingHandler,
} from './handler-boundary';
import { requireMessagingActor } from './principal';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import { composeMessagingPreferences } from './preference-composition';
export function composeMessagingPreferenceRoutes(app: App) {
  return (
    request: Request,
    operation: 'read' | 'update' | 'clear',
    channelId?: string,
  ) => {
    const policy = app.messagingPolicy;
    if (!policy)
      return unavailableMessagingHandler(
        app,
        request,
        'messaging.preferences.unavailable',
      );
    return createMessagingPreferenceHandler({
      boundary: messagingHttpBoundary(app),
      maxBodyBytes: policy.maxBodyBytes,
      consume: (actorId) =>
        consumeOrThrow(
          app.auth().limiter,
          `messaging:preferences:${actorId}`,
          policy.limits.read,
        ),
      store: (principal) =>
        composeMessagingPreferences({
          database: app.database,
          principal,
          policy,
          clock: app.clock,
        }),
    })(request, operation, channelId);
  };
}
/** The real HTTP boundary and persistence port remain injected; no request chooses its authority fence. */
export function createMessagingPreferenceHandler({
  boundary,
  maxBodyBytes,
  consume,
  store,
}: {
  readonly boundary: Parameters<typeof runMessagingHandler>[0];
  readonly maxBodyBytes: number;
  readonly consume: (actorId: string) => Promise<void>;
  readonly store: (
    principal: Parameters<
      Parameters<typeof runMessagingHandler>[2]['operation']
    >[1],
  ) => ReturnType<typeof composeMessagingPreferences>;
}) {
  return (
    request: Request,
    operation: 'read' | 'update' | 'clear',
    channelId?: string,
  ) =>
    runMessagingHandler(boundary, request, {
      name: `messaging.preferences.${operation}`,
      readOnly: operation === 'read',
      readInput: async () => {
        if (operation !== 'read') return readJson(request, maxBodyBytes);
        if ([...new URL(request.url).searchParams.keys()].length)
          throw createAppError('VALIDATION');
        return { version: 1, channelId };
      },
      operation: async (input, principal) => {
        const actor = requireMessagingActor(principal);
        await consume(actor.actorId);
        const preferences = store(principal);
        if (operation === 'update') {
          const command = parseValidated(
            messagingPreferenceSchemas.update,
            input,
          );
          return messagingPreferenceSchemas.result.parse({
            version: 1,
            channelId: command.channelId,
            ...(await preferences.update(
              { ...actor, channelId: command.channelId },
              command,
            )),
          });
        }
        const command = parseValidated(messagingPreferenceSchemas.scope, input);
        const scope = { ...actor, channelId: command.channelId };
        return operation === 'clear'
          ? messagingPreferenceSchemas.cleared.parse({
              ...command,
              cleared: await preferences.clear(scope),
            })
          : messagingPreferenceSchemas.result.parse({
              ...command,
              ...(await preferences.read(scope)),
            });
      },
    });
}
