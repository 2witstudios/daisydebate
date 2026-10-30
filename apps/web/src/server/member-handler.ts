import type { Identity } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { createAppError } from '@daisy/errors';
import { identify } from '../lib/identity';
import type { App } from './app';
import {
  handleOperation,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from './http';

export type MemberBoundary = {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from a member operation's raw error goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
};
/** An identity whose principal the evaluator decides for: members and the waitlisted. */
export const evaluatedIdentity = (
  identity: Identity,
): identity is Extract<Identity, { state: 'member' | 'waitlisted' }> =>
  identity.state === 'member' || identity.state === 'waitlisted';

/**
 * One signed-in member operation behind same-origin checks: messaging,
 * friends and presence handlers all run through it.
 */
export function runMemberHandler(
  boundary: MemberBoundary,
  request: Request,
  input: {
    readonly name: string;
    readonly readOnly: boolean;
    readonly readInput: () => Promise<unknown>;
    readonly operation: (
      value: unknown,
      principal: AuthorizationPrincipal,
    ) => Promise<unknown>;
    readonly headers?: HeadersInit;
    readonly respond?: (value: unknown) => Response;
  },
) {
  return handleOperation(
    boundary.logger,
    request,
    input.name,
    async () => {
      if (input.readOnly) requireSameOriginRead(request, boundary.origin());
      else requireSameOrigin(request, boundary.origin());
      const identity = requireSignedIn(await boundary.identify(request));
      // A waitlisted account reaches the evaluator, the sole decision: it
      // keeps only its withdrawals there (ADR 0075).
      if (!evaluatedIdentity(identity)) throw createAppError('AUTHORIZATION');
      const value = await input.operation(
        await input.readInput(),
        identity.principal,
      );
      return input.respond
        ? input.respond(value)
        : Response.json(value, { headers: input.headers ?? {} });
    },
    boundary.reporter,
  );
}

/** App-bound identity, injected at the HTTP edge of each member route. */
export function memberHttpBoundary(app: App): MemberBoundary {
  return {
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    identify: (request) => identify(app.auth(), request.headers),
  };
}
