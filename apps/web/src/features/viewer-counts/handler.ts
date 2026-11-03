import type { Clock } from '@daisy/clock';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { idSchema, viewerPulseSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { presentedLinkHash } from '../audience-link/audience-link';
import { admitAudience } from '../spectating/read-timeline';
import { roundIdOf } from '../../server/account-route';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
} from '../../server/http';
import {
  consumeOrThrow,
  readLimiterDecision,
  type RateLimiter,
} from '../../server/rate-limit';
import { createSnapshotMemo } from '../spectating/snapshot-memo';
import { VIEWER_BUCKET_TTL_MS, viewerBucketOf } from './viewer-count';

const ON_AIR_TTL_MS = 5000;
const ON_AIR_ROUNDS = 5000;
/** A shared address can hold a whole room of viewers; this only stops a flood. */
const PULSE_LIMIT = { max: 600, windowSeconds: 60 };
/**
 * A tab an address has not been heard from lately, so one script cannot inflate a
 * count with made-up tokens. Repeats cost nothing here.
 */
const NEW_TAB_LIMIT = { max: 60, windowSeconds: 60 };
const TAB_SEEN = { max: 1, windowSeconds: 60 };

/**
 * POST /api/rounds/:id/viewers: one tab says it is watching. It reads no session
 * and takes no identity, and the address goes only into the limiter's hashed key,
 * so no count can be tied to anyone, in any log or event. An unlisted Round counts
 * only the holder of its link, the one cookie read here, which names a Round and
 * no one. A Round off the air, or closed to this tab, answers the same and stores
 * nothing.
 */
export function createViewerPulseRoute(deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly limiter: () => RateLimiter;
  readonly clock: Pick<Clock, 'now'>;
  readonly store: {
    readonly readOnAirAudience: (input: {
      readonly roundId: string;
    }) => Promise<{ readonly visibility: 'public' | 'unlisted' } | null>;
  } & Parameters<typeof admitAudience>[0];
  readonly counts: {
    readonly recordViewerPulse: (pulse: {
      readonly roundId: string;
      readonly bucket: number;
      readonly token: string;
      readonly ttlMs: number;
    }) => Promise<void>;
  };
}) {
  // Keyed by Round alone and holding no link: admission happens after it.
  const onAir = createSnapshotMemo<{
    readonly visibility: 'public' | 'unlisted';
  } | null>({
    nowMs: () => Date.parse(deps.clock.now()),
    ttlMs: ON_AIR_TTL_MS,
    maxEntries: ON_AIR_ROUNDS,
  });
  return (request: Request) =>
    handleOperation(
      deps.logger,
      request,
      'audience.viewer-pulse',
      async () => {
        requireSameOrigin(request, deps.origin());
        const roundId = roundIdOf(request);
        if (!idSchema.safeParse(roundId).success)
          throw createAppError('NOT_FOUND');
        await consumeOrThrow(
          deps.limiter(),
          `audience:pulse:${request.headers.get(CLIENT_IP_HEADER) ?? 'unknown'}`,
          PULSE_LIMIT,
        );
        const { token } = parseValidated(
          viewerPulseSchema,
          await readJson(request, 256),
        );
        const address = request.headers.get(CLIENT_IP_HEADER) ?? 'unknown';
        const seen = await deps
          .limiter()
          .consume(`audience:pulse-seen:${address}:${token}`, TAB_SEEN);
        if (readLimiterDecision(seen).allowed)
          await consumeOrThrow(
            deps.limiter(),
            `audience:pulse-new:${address}`,
            NEW_TAB_LIMIT,
          );
        const audience = await onAir(roundId, () =>
          deps.store.readOnAirAudience({ roundId }),
        );
        if (
          audience &&
          (await admitAudience(deps.store, audience, {
            roundId,
            presentedHash: presentedLinkHash(
              request.headers.get('cookie'),
              roundId,
            ),
          }))
        )
          await deps.counts.recordViewerPulse({
            roundId,
            bucket: viewerBucketOf(Date.parse(deps.clock.now())),
            token,
            ttlMs: VIEWER_BUCKET_TTL_MS,
          });
        return new Response(null, { status: 204 });
      },
      deps.reporter,
    );
}
