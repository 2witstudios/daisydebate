import { messagingTypingSchemas } from '@daisy/protocol';
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
import { composeMessagingTyping } from './typing-operations';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
export function composeMessagingTypingRoutes(app: App) {
  return (request: Request, write: boolean, channelId?: string) => {
    const policy = app.messagingPolicy;
    if (!policy?.typing)
      return unavailableMessagingHandler(
        app,
        request,
        'messaging.typing.unavailable',
      );
    const bounds = parseValidated(messagingTypingSchemas.policy, policy.typing);
    return createMessagingTypingHandler({
      ...messagingActorHandlerPort(app, policy, 'typing'),
      store: (principal) =>
        composeMessagingTyping({
          database: app.database,
          redis: app.redis,
          clock: app.clock,
          principal,
          policy,
          bounds,
          readAccounts: loadAccountPolicyFacts,
        }),
    })(request, write, channelId);
  };
}
/** The actual HTTP adapter validates input before its current-authority operation port. */
export function createMessagingTypingHandler({
  boundary,
  maxBodyBytes,
  consume,
  store,
}: MessagingHandlerPort<ReturnType<typeof composeMessagingTyping>>) {
  return (request: Request, write: boolean, channelId?: string) =>
    runMessagingHandler(boundary, request, {
      name: write ? 'messaging.typing.update' : 'messaging.typing.read',
      readOnly: !write,
      readInput: () =>
        readMessagingScope(request, write, maxBodyBytes, channelId),
      operation: async (value, principal) => {
        const actor = requireMessagingActor(principal);
        await consume(actor.actorId);
        const operations = store(principal);
        if (write) {
          const command = parseValidated(messagingTypingSchemas.update, value);
          return operations.update(command.channelId, command.typing);
        }
        return operations.read(
          parseValidated(messagingTypingSchemas.scope, value).channelId,
        );
      },
    });
}
