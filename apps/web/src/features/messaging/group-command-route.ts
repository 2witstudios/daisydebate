import type { OperationName } from '../ops/operation-names';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { consumeWindowsOrThrow } from '../../server/rate-limit';

import type { MessagingRuntimePolicy } from './composition';
import type { MessagingSocialRuntimePolicy } from './social-composition';
import {
  memberHttpBoundary,
  runEvaluatedRoute,
} from '../../server/member-boundary';
type Context = {
  readonly policy: MessagingRuntimePolicy;
  readonly social: MessagingSocialRuntimePolicy;
  readonly limit: (actorId: string) => Promise<void>;
};
/** Both membership writes retain the same native HTTP identity/origin/error boundary. */
export function messagingGroupCommandRoute(
  app: App,
  name: OperationName,
  operation: (
    input: unknown,
    principal: AuthorizationPrincipal,
    context: Context,
  ) => Promise<unknown>,
) {
  return (request: Request) => {
    const policy = app.messagingPolicy,
      social = policy.social;
    const context = {
      policy,
      social,
      limit: (actorId: string) =>
        consumeWindowsOrThrow(
          app.limiter,
          `messaging:social:${actorId}`,
          social.abuse,
        ),
    };
    return runEvaluatedRoute(memberHttpBoundary(app), request, {
      name,
      readOnly: false,
      readInput: () => readJson(request, policy.maxBodyBytes),
      operation: (input, principal) => operation(input, principal, context),
    });
  };
}
