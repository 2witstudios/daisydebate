import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { handleOperation, PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { readSpectatorTimeline } from './read-timeline';
import type { SpectatorTimelineContext } from './timeline';
import { createSnapshotMemo } from './snapshot-memo';

const SNAPSHOT_TTL_MS = 1000;
const SNAPSHOT_ROUNDS = 5000;

/**
 * The audience's one read: anonymous and the same for everyone, so it reads no
 * cookie or session, sets none, and may sit on a CDN. A Round with no audience
 * is one answer, never cached, whether it is private or missing.
 */
export function createSpectatorTimelineHandlers(deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly store: Pick<Database, 'readSpectatorTimeline'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly feedUrlOf: SpectatorTimelineContext['feedUrlOf'];
}) {
  const memo = createSnapshotMemo<Awaited<ReturnType<typeof read>>>({
    nowMs: () => Date.parse(deps.clock.now()),
    ttlMs: SNAPSHOT_TTL_MS,
    maxEntries: SNAPSHOT_ROUNDS,
  });
  const read = (roundId: string) =>
    readSpectatorTimeline(deps.store, {
      roundId,
      now: deps.clock.now(),
      feedUrlOf: deps.feedUrlOf,
    });
  return {
    GET: (request: Request, roundId: string) =>
      handleOperation(
        deps.logger,
        request,
        'spectating.timeline',
        async () => {
          const timeline = await memo(roundId, () => read(roundId));
          if (timeline === null)
            return Response.json(
              { error: { code: 'NOT_FOUND' } },
              { status: 404 },
            );
          return Response.json(timeline, {
            headers: {
              'Cache-Control': PUBLIC_SNAPSHOT_CACHE,
              // An unlisted Round is reached by its link alone.
              'X-Robots-Tag': 'noindex',
            },
          });
        },
        deps.reporter,
      ),
  };
}
