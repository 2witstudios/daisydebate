import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { z } from 'zod';
import {
  handleOperation,
  parseValidated,
  readJson,
  refusalResponse,
  requireSameOrigin,
  requireSignedIn,
} from '../../server/http';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';
import { CONTENT_WAIVER_VERSION } from '../legal/agreements';

const signatureRequest = z.strictObject({
  version: z.string().min(1).max(64),
  /** The member ticked the box; a post without it signs nothing. */
  accepted: z.literal('yes'),
});

/** A closed vocabulary: the words moved on, or no season is open to sign for. */
export const contentWaiverRefusals = [
  'content-waiver-changed',
  'ranked-unavailable',
] as const;

const MAX_BODY_BYTES = 1024;
const SIGN_LIMIT = { max: 10, windowSeconds: 60 };

/**
 * POST /api/agreements/content-waiver: a member signs the waiver for the
 * active season (WATCH-15). The version must be the one served now, so nobody
 * is recorded as signing words their form did not show. Signing again is the
 * same signature. Any beta state may read the waiver; only a member signs.
 */
export function createContentWaiverHandler({
  logger,
  reporter,
  origin,
  identify,
  limiter,
  sign,
}: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly sign: (
    userId: string,
    version: string,
  ) => Promise<'signed' | 'no-active-season'>;
}) {
  return (request: Request) =>
    handleOperation(
      logger,
      request,
      'agreements.content-waiver',
      async (requestId) => {
        requireSameOrigin(request, origin());
        const identity = requireSignedIn(await identify(request));
        if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
        const { userId } = identity.principal;
        await consumeOrThrow(
          limiter(),
          `agreements:content-waiver:${userId}`,
          SIGN_LIMIT,
        );
        const { version } = parseValidated(
          signatureRequest,
          await readJson(request, MAX_BODY_BYTES),
        );
        try {
          if (version !== CONTENT_WAIVER_VERSION)
            throw createAppError('CONFLICT', 'content-waiver-changed');
          if ((await sign(userId, version)) === 'no-active-season')
            throw createAppError('CONFLICT', 'ranked-unavailable');
          return Response.json({ signed: true });
        } catch (error) {
          const refused = refusalResponse(
            error,
            requestId,
            contentWaiverRefusals,
          );
          if (refused) return refused;
          throw error;
        }
      },
      reporter,
    );
}
