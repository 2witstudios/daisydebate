import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { leagueRequestSchema } from '@daisy/protocol/league-request';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
} from '../../server/http';
import {
  consumeOrThrow,
  consumeWindowsOrThrow,
  type RateLimiter,
  type RateRule,
} from '../../server/rate-limit';

/**
 * One client's League requests: a league talks to us once or twice, so five
 * an hour and ten a day leave room for a typo and stop a script. The
 * ingress-stamped client address is hashed into the key by the limiter and
 * never logged; a request without one shares a single bucket.
 */
export const leagueRequestClientRules: readonly RateRule[] = [
  { windowSeconds: 3_600, max: 5 },
  { windowSeconds: 86_400, max: 10 },
];
/**
 * Every client together: caps what rotating addresses can put in the
 * owner's inbox, set high enough above any real day of leagues that a few
 * abusive clients cannot close the form to everyone else.
 */
export const leagueRequestEveryoneRule: RateRule = {
  windowSeconds: 86_400,
  max: 500,
};

/** Big enough for every field at its limit, with JSON escaping. */
const MAX_BODY_BYTES = 32_768;

/**
 * POST /api/league-requests (PYL-17): a League "Talk to us" request, signed
 * in or not. Same origin only, open only while `league-requests` is (the
 * Next route module supplies `released`, so the flag stays out of the
 * proxy's route table), and limited per client and for everyone before
 * anything is stored. A resend of a request already stored unchanged
 * answers the same without spending any allowance, so a resend is safe.
 */
export const createLeagueRequestHandlers = (deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly limiter: () => RateLimiter;
  readonly store: Pick<
    Database,
    'leagueRequestUnchanged' | 'recordLeagueRequest'
  >;
}) => ({
  POST: (released: () => Promise<boolean>) => (request: Request) =>
    handleOperation(
      deps.logger,
      request,
      'league-request.create',
      async () => {
        requireSameOrigin(request, deps.origin());
        if (!(await released())) throw createAppError('NOT_FOUND');
        const body = parseValidated(
          leagueRequestSchema,
          await readJson(request, MAX_BODY_BYTES),
        );
        if (await deps.store.leagueRequestUnchanged(body))
          return Response.json({ received: true });
        const client = request.headers.get(CLIENT_IP_HEADER) ?? 'unresolved';
        await consumeWindowsOrThrow(
          deps.limiter(),
          `league-request:client:${client}`,
          leagueRequestClientRules,
        );
        await consumeOrThrow(
          deps.limiter(),
          'league-request:everyone',
          leagueRequestEveryoneRule,
        );
        await deps.store.recordLeagueRequest(body);
        return Response.json({ received: true });
      },
      deps.reporter,
    ),
});
