import type { OperationName } from '../features/ops/operation-names';
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
import { consumeOrThrow, type RateLimiter, type RateRule } from './rate-limit';

export type MemberBoundary = {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from a member operation's raw error goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
};
/** The boundary of a route that spends the member's own budget. */
export type BudgetedMemberBoundary = MemberBoundary & {
  readonly limiter: () => RateLimiter;
};
export type MemberCaller = {
  readonly userId: string;
  readonly actorId: string;
};
type Route = {
  readonly name: OperationName;
  readonly readOnly: boolean;
  /** The evaluator decides, so an account that may only withdraw reaches it too (ADR 0075). */
  readonly evaluatorDecides?: boolean;
};
type RouteContext = {
  readonly requestId: string;
  readonly logger: Logger;
};

/** An identity whose principal the evaluator decides for, keeping only its withdrawals (ADR 0075). */
export const evaluatedIdentity = (
  identity: Identity,
): identity is Extract<
  Identity,
  { state: 'member' | 'waitlisted' | 'restricted' }
> =>
  identity.state === 'member' ||
  identity.state === 'waitlisted' ||
  identity.state === 'restricted';

/**
 * Every signed-in route's gates, in ADR 0020's order: same origin, session,
 * who may pass, then the work.
 *
 * The actor is read once a request, by identity resolution, and never again
 * here: a route's actor is what that read returned, and a durable write
 * checks it again under the account fence. A missing actor resolves
 * `unavailable`, so it answers as an outage before any route runs.
 */
function runGated(
  boundary: MemberBoundary,
  request: Request,
  route: Route,
  work: (
    identity: Extract<
      Identity,
      { state: 'member' | 'waitlisted' | 'restricted' }
    >,
    context: RouteContext,
  ) => Promise<Response>,
) {
  return handleOperation(
    boundary.logger,
    request,
    route.name,
    async (requestId, logger) => {
      if (route.readOnly) requireSameOriginRead(request, boundary.origin());
      else requireSameOrigin(request, boundary.origin());
      const identity = requireSignedIn(await boundary.identify(request));
      if (
        !evaluatedIdentity(identity) ||
        (identity.state !== 'member' && !route.evaluatorDecides)
      )
        throw createAppError('AUTHORIZATION');
      return work(identity, { requestId, logger });
    },
    boundary.reporter,
  );
}

/**
 * A route that acts as the member's actor at once, spending the feature's own
 * budget; the member's id completes the key.
 */
export function runMemberRoute(
  boundary: BudgetedMemberBoundary,
  request: Request,
  route: Route & {
    readonly bucket: string;
    readonly rule: RateRule;
    /** Refuses what cannot proceed before it spends the member's budget. */
    readonly beforeBudget?: () => void;
  },
  action: (caller: MemberCaller, context: RouteContext) => Promise<Response>,
) {
  return runGated(boundary, request, route, async (identity, context) => {
    route.beforeBudget?.();
    const { userId, actorId } = identity.principal;
    if (actorId === null) throw createAppError('INFRASTRUCTURE');
    await consumeOrThrow(
      boundary.limiter(),
      `${route.bucket}:${userId}`,
      route.rule,
    );
    return action({ userId, actorId }, context);
  });
}

/**
 * A route whose operation takes the principal to its evaluator, the sole
 * decision, and spends any budget itself: messaging, friends and presence.
 */
export function runEvaluatedRoute(
  boundary: MemberBoundary,
  request: Request,
  input: Omit<Route, 'evaluatorDecides'> & {
    readonly readInput: () => Promise<unknown>;
    readonly operation: (
      value: unknown,
      principal: AuthorizationPrincipal,
    ) => Promise<unknown>;
    readonly headers?: HeadersInit;
    readonly respond?: (value: unknown) => Response;
  },
) {
  return runGated(
    boundary,
    request,
    { ...input, evaluatorDecides: true },
    async (identity) => {
      const value = await input.operation(
        await input.readInput(),
        identity.principal,
      );
      return input.respond
        ? input.respond(value)
        : Response.json(value, { headers: input.headers ?? {} });
    },
  );
}

/** App-bound identity and budget, injected at the HTTP edge of each member route. */
export function memberHttpBoundary(app: App): BudgetedMemberBoundary {
  return {
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    identify: (request) => identify(app.auth(), request.headers),
    limiter: () => app.limiter,
  };
}
