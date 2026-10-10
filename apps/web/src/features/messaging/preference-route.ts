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
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name: `messaging.preferences.${operation}`,
      readOnly: operation === 'read',
      readInput: async () => {
        if (operation !== 'read') return readJson(request, policy.maxBodyBytes);
        if ([...new URL(request.url).searchParams.keys()].length)
          throw createAppError('VALIDATION');
        return { version: 1, channelId };
      },
      operation: async (input, principal) => {
        const actor = requireMessagingActor(principal);
        await consumeOrThrow(
          app.auth().limiter,
          `messaging:preferences:${actor.actorId}`,
          policy.limits.read,
        );
        const store = composeMessagingPreferences({
          database: app.database,
          principal,
          policy,
          clock: app.clock,
        });
        if (operation === 'update') {
          const command = parseValidated(
            messagingPreferenceSchemas.update,
            input,
          );
          return messagingPreferenceSchemas.result.parse({
            version: 1,
            channelId: command.channelId,
            ...(await store.update(
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
              cleared: await store.clear(scope),
            })
          : messagingPreferenceSchemas.result.parse({
              ...command,
              ...(await store.read(scope)),
            });
      },
    });
  };
}
