import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';

/**
 * One address's reads of the audience routes a minute. A tab polls about twice a
 * second across them and a shared address can hold a room, so this only stops a flood.
 */
const ANONYMOUS_READ_LIMIT = { max: 2400, windowSeconds: 60 };

/** The per-client limit on anonymous reads. The address goes only into the hashed key. */
export const limitAnonymousReads =
  (limiter: () => RateLimiter) =>
  (request: Request): Promise<unknown> =>
    consumeOrThrow(
      limiter(),
      `audience:read:${request.headers.get(CLIENT_IP_HEADER) ?? 'unknown'}`,
      ANONYMOUS_READ_LIMIT,
    );
