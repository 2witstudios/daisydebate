import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { handleOperation, PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { presentedLinkHash } from '../audience-link/audience-link';
import { admitAudience, createWatchRoundSnapshots } from './read-timeline';
import type { SpectatorTimelineContext } from './timeline';
import { joinReadInFlight } from './in-flight-read';
import { answerUnlessRefused } from './refused-read';

type LinkRead = Awaited<ReturnType<Database['readRoundAudienceLink']>>;

/**
 * The audience's one read: anonymous and the same for everyone, so it reads no
 * session and sets no cookie. A public Round's answer may sit on a CDN. An
 * unlisted Round's never may: it is read past its link cookie and answered
 * no-store, so a shared cache can hold nothing to serve to someone without the
 * link. A Round with no audience is one answer, never cached, whether it is
 * private, missing or an unlisted Round without its current link. A crowd costs
 * one read and one serialization per Round per second. A full lane refuses at once
 * and the viewer keeps what it has (ADR 0088 §6).
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
  const snapshots = createWatchRoundSnapshots(deps);
  const links = joinReadInFlight<LinkRead>();
  const linkStore = {
    readRoundAudienceLink: (roundId: string) =>
      links(roundId, () => deps.store.readRoundAudienceLink(roundId)),
  };
  return {
    GET: (request: Request, roundId: string) =>
      handleOperation(
        deps.logger,
        request,
        'spectating.timeline',
        () =>
          answerUnlessRefused(async () => {
            const snapshot = await snapshots(roundId);
            const admitted =
              snapshot !== null &&
              (await admitAudience(linkStore, snapshot, {
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
            return new Response(snapshot.body, {
              headers: {
                'Content-Type': 'application/json',
                // handleOperation answers anything else no-store.
                ...(snapshot.visibility === 'public'
                  ? { 'Cache-Control': PUBLIC_SNAPSHOT_CACHE }
                  : {}),
                'X-Robots-Tag': 'noindex',
              },
            });
          }),
        deps.reporter,
      ),
  };
}
