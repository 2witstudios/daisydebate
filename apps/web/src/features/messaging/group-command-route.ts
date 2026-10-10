import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import {
  messagingHttpBoundary,
  runMessagingHandler,
  unavailableMessagingHandler,
} from './handler-boundary';
import type { MessagingRuntimePolicy } from './composition';
import type { MessagingSocialRuntimePolicy } from './social-composition';
type Context = {
  readonly policy: MessagingRuntimePolicy;
  readonly social: MessagingSocialRuntimePolicy;
  readonly limit: (actorId: string) => Promise<void>;
};
/** Both membership writes retain the same native HTTP identity/origin/error boundary. */
export function messagingGroupCommandRoute(
  app: App,
  name: string,
  operation: (
    input: unknown,
    principal: AuthorizationPrincipal,
    context: Context,
  ) => Promise<unknown>,
) {
  return (request: Request) => {
    const policy = app.messagingPolicy,
      social = policy?.social;
    if (!policy || !social) return unavailableMessagingHandler(app, request);
    const context = {
      policy,
      social,
      limit: (actorId: string) =>
        consumeOrThrow(
          app.auth().limiter,
          `messaging:social:${actorId}`,
          social.abuse,
        ),
    };
    return runMessagingHandler(messagingHttpBoundary(app), request, {
      name,
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: (input, principal) => operation(input, principal, context),
    });
  };
}
