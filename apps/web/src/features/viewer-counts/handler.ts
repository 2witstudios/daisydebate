import type { Clock } from '@daisy/clock';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { idSchema, viewerPulseSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { roundIdOf } from '../../server/account-route';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
} from '../../server/http';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';
import { createSnapshotMemo } from '../spectating/snapshot-memo';
import { VIEWER_BUCKET_TTL_MS, viewerBucketOf } from './viewer-count';

const ON_AIR_TTL_MS = 5000;
const ON_AIR_ROUNDS = 5000;
/** A shared address can hold a whole room of viewers; this only stops a flood. */
const PULSE_LIMIT = { max: 600, windowSeconds: 60 };

/**
 * POST /api/rounds/:id/viewers: one tab says it is watching. It reads no cookie
 * or session and takes no identity, and the address goes only into the limiter's
 * hashed key, so no count can be tied to anyone, in any log or event. A Round off
 * the air answers the same and stores nothing.
 */
export function createViewerPulseRoute(deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly limiter: () => RateLimiter;
  readonly clock: Pick<Clock, 'now'>;
  readonly store: {
    readonly readBroadcastOnAir: (input: {
      readonly roundId: string;
    }) => Promise<boolean>;
  };
  readonly counts: {
    readonly recordViewerPulse: (pulse: {
      readonly roundId: string;
      readonly bucket: number;
      readonly token: string;
      readonly ttlMs: number;
    }) => Promise<void>;
  };
}) {
  const onAir = createSnapshotMemo<boolean>({
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
        if (
          await onAir(roundId, () => deps.store.readBroadcastOnAir({ roundId }))
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
