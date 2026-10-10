import { messagingPreferenceSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated } from '../../server/http';
import {
  runMessagingHandler,
  messagingActorHandlerPort,
  unavailableMessagingHandler,
  readMessagingScope,
  type MessagingHandlerPort,
} from './handler-boundary';
import { requireMessagingActor } from './principal';
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
      ...messagingActorHandlerPort(app, policy, 'preferences'),
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
}: MessagingHandlerPort<ReturnType<typeof composeMessagingPreferences>>) {
  return (
    request: Request,
    operation: 'read' | 'update' | 'clear',
    channelId?: string,
  ) =>
    runMessagingHandler(boundary, request, {
      name: `messaging.preferences.${operation}`,
      readOnly: operation === 'read',
      readInput: () =>
        readMessagingScope(
          request,
          operation !== 'read',
          maxBodyBytes,
          channelId,
        ),
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
