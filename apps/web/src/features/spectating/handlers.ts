import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { handleOperation, PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { presentedLinkHash } from '../audience-link/audience-link';
import { admitAudience, readAudienceSnapshot } from './read-timeline';
import type { SpectatorTimelineContext } from './timeline';
import { createSnapshotMemo } from './snapshot-memo';

const SNAPSHOT_TTL_MS = 1000;
const SNAPSHOT_ROUNDS = 5000;

/**
 * The audience's one read: anonymous and the same for everyone, so it reads no
 * session and sets no cookie. A public Round's answer may sit on a CDN. An
 * unlisted Round's never may: it is read past its link cookie and answered
 * no-store, so a shared cache can hold nothing to serve to someone without the
 * link. A Round with no audience is one answer, never cached, whether it is
 * private, missing or an unlisted Round without its current link.
 */
export function createSpectatorTimelineHandlers(deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly store: Pick<
    Database,
    'readSpectatorTimeline' | 'readRoundAudienceLink'
  >;
  readonly clock: Pick<Clock, 'now'>;
  readonly feedUrlOf: SpectatorTimelineContext['feedUrlOf'];
}) {
  // Keyed by Round alone and holding no link: admission happens after it.
  const memo = createSnapshotMemo<Awaited<ReturnType<typeof read>>>({
    nowMs: () => Date.parse(deps.clock.now()),
    ttlMs: SNAPSHOT_TTL_MS,
    maxEntries: SNAPSHOT_ROUNDS,
  });
  const read = (roundId: string) =>
    readAudienceSnapshot(deps.store, {
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
          const snapshot = await memo(roundId, () => read(roundId));
          const admitted =
            snapshot !== null &&
            (await admitAudience(deps.store, snapshot, {
              roundId,
              presentedHash: presentedLinkHash(
                request.headers.get('cookie'),
                roundId,
              ),
            }));
          if (!admitted)
            return Response.json(
              { error: { code: 'NOT_FOUND' } },
              { status: 404 },
            );
          return Response.json(snapshot.timeline, {
            headers: {
              // handleOperation answers anything else no-store.
              ...(snapshot.visibility === 'public'
                ? { 'Cache-Control': PUBLIC_SNAPSHOT_CACHE }
                : {}),
              'X-Robots-Tag': 'noindex',
            },
          });
        },
        deps.reporter,
      ),
  };
}
