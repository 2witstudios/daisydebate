import type { Identity } from '@daisy/auth';
import { createRefusal } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import type { OperationName } from '../features/ops/operation-names';
import {
  handleOperation,
  readJson,
  refusalResponse,
  requireSameOrigin,
  requireSignedIn,
  type SignedInIdentity,
} from './http';
import { consumeOrThrow, type RateLimiter, type RateRule } from './rate-limit';

export type AccountRouteDeps = {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
};

/**
 * A mutation that needs an account, not admission (the owner's rule for audience
 * interaction): same origin, signed in, one rate limit per account, a bounded
 * body, then the work. `refusals` are the fixed keys the work may answer with.
 */
export const accountRoute =
  (
    deps: AccountRouteDeps,
    route: {
      readonly operation: OperationName;
      readonly limit: RateRule;
      readonly maxBodyBytes: number;
      readonly refusals: Parameters<typeof refusalResponse>[2];
    },
    work: (input: {
      readonly identity: SignedInIdentity;
      readonly body: unknown;
    }) => Promise<Response>,
  ) =>
  (request: Request) =>
    handleOperation(
      deps.logger,
      request,
      route.operation,
      async (requestId) => {
        requireSameOrigin(request, deps.origin());
        const identity = requireSignedIn(await deps.identify(request));
        await consumeOrThrow(
          deps.limiter(),
          `${route.operation}:${identity.principal.userId}`,
          route.limit,
        );
        const body = await readJson(request, route.maxBodyBytes);
        try {
          return await work({ identity, body });
        } catch (error) {
          const refused = refusalResponse(error, requestId, route.refusals);
          if (refused) return refused;
          throw error;
        }
      },
      deps.reporter,
    );

/**
 * The account rule for audience interaction (WATCH-1): any account may chat,
 * react, report and follow, admitted or not, unless a suspension or ban is in
 * force. Sign-in is not enough for a restricted account; reading stays open.
 */
export const refuseRestricted = (identity: SignedInIdentity): void => {
  if (identity.state === 'restricted')
    throw createRefusal('AUTHORIZATION', 'account-restricted');
};

/** An account mutation that is audience interaction: the rule above, then the work. */
export const audienceRoute = (
  deps: AccountRouteDeps,
  route: Parameters<typeof accountRoute>[1],
  work: Parameters<typeof accountRoute>[2],
) =>
  accountRoute(
    deps,
    { ...route, refusals: [...route.refusals, 'account-restricted'] },
    (input) => {
      refuseRestricted(input.identity);
      return work(input);
    },
  );

/** The Round id a `/api/rounds/<id>/...` route was called with. */
export const roundIdOf = (request: Request) =>
  new URL(request.url).pathname.split('/')[3] ?? '';
