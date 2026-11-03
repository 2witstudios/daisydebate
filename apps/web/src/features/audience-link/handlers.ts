import type { Identity } from '@daisy/auth';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { handleOperation, requireSameOrigin } from '../../server/http';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';
import { liveHref } from '../watch/routes';
import {
  audienceLinkCookie,
  audienceLinkHash,
  audienceLinkHref,
  isAudienceLinkToken,
  newAudienceLinkToken,
} from './audience-link';
import { issueAudienceLink } from './issue-link';

const issueRule = { max: 20, windowSeconds: 3600 };

/**
 * Opening a link and issuing one. Opening reads nothing: every link, right or
 * wrong, for any Round or none, answers the same move to the clean Round page,
 * which alone decides. A cookie it sets admits nobody by itself.
 */
export const createAudienceLinkHandlers = (deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly store: Parameters<typeof issueAudienceLink>[0]['store'];
}) => ({
  open: (request: Request, roundId: string) =>
    handleOperation(
      deps.logger,
      request,
      'audience-link.open',
      async () => {
        const token = new URL(request.url).searchParams.get('token');
        const headers = new Headers({
          location: liveHref(roundId),
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex',
        });
        if (idSchema.safeParse(roundId).success && isAudienceLinkToken(token))
          headers.set(
            'set-cookie',
            audienceLinkCookie(roundId, token, {
              secure: deps.origin().startsWith('https:'),
            }),
          );
        return new Response(null, { status: 303, headers });
      },
      deps.reporter,
    ),

  /** POST by the host. The answer is the only place the token is ever shown. */
  issue: (request: Request, roundId: string) =>
    handleOperation(
      deps.logger,
      request,
      'audience-link.issue',
      async () => {
        requireSameOrigin(request, deps.origin());
        const identity = await deps.identify(request);
        if (identity.state !== 'member') throw createAppError('NOT_FOUND');
        const { userId, actorId } = identity.principal;
        await consumeOrThrow(
          deps.limiter(),
          `audience-link:issue:${userId}`,
          issueRule,
        );
        const token = await issueAudienceLink(
          {
            store: deps.store,
            newToken: newAudienceLinkToken,
            hashOf: audienceLinkHash,
          },
          { roundId, caller: { userId, actorId } },
        );
        return Response.json({ href: audienceLinkHref(roundId, token) });
      },
      deps.reporter,
    ),
});
