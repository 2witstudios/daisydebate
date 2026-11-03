import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import {
  audienceReactionKinds,
  idSchema,
  type AudienceReactionKind,
  type AudienceSnapshot,
} from '@daisy/protocol';
import { handleOperation, PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { releasedViewerBucket } from '../viewer-counts/viewer-count';
import { createSnapshotMemo } from './snapshot-memo';
import { audienceShownTo, type AudienceShown } from './seated-audience';
import { spectatorClockAt } from './spectator-clock';

const SNAPSHOT_TTL_MS = 1000;
const SNAPSHOT_ROUNDS = 5000;

type Read = NonNullable<Awaited<ReturnType<Database['readAudienceSnapshot']>>>;

/** Every reaction kind in its order, with zero for one nobody has used. */
const reactionTotals = (read: Read): AudienceSnapshot['reactions'] =>
  audienceReactionKinds.map((kind: AudienceReactionKind) => ({
    kind,
    count: read.reactions.find((row) => row.kind === kind)?.count ?? 0,
  }));

/** Built from released rows alone. A zero count is no count: nothing to say. */
export const projectAudienceSnapshot = (
  roundId: string,
  read: Read,
  viewers: number | null,
): AudienceSnapshot => ({
  version: 1,
  roundId,
  interaction: !read.hasBroadcast
    ? 'unavailable'
    : read.open
      ? 'open'
      : 'closed',
  messages: read.messages,
  reactions: reactionTotals(read),
  viewers: viewers === 0 ? null : viewers,
});

export type AudienceSnapshotStore = Pick<Database, 'readAudienceSnapshot'>;
export type ViewerCounts = {
  readonly readViewerCount: (
    roundId: string,
    bucket: number,
  ) => Promise<number>;
};

/**
 * A lost count must not take the rest with it: Redis is expendable (AGENTS.md),
 * and a count drives nothing. Null when the snapshot has no audience.
 */
export const readAudienceSnapshot = async (
  deps: {
    readonly store: AudienceSnapshotStore;
    readonly counts: ViewerCounts;
  },
  input: { readonly roundId: string; readonly now: string },
): Promise<AudienceSnapshot | null> => {
  if (!idSchema.safeParse(input.roundId).success) return null;
  const read = await deps.store.readAudienceSnapshot({
    roundId: input.roundId,
    clock: spectatorClockAt(input.now),
  });
  if (!read) return null;
  const bucket = releasedViewerBucket(read.horizonMs);
  const viewers =
    bucket === null
      ? null
      : await deps.counts
          .readViewerCount(input.roundId, bucket)
          .catch(() => null);
  return projectAudienceSnapshot(input.roundId, read, viewers);
};

/**
 * GET /api/rounds/:id/audience: anonymous, the same for everyone, and cacheable,
 * as the timeline is. It reads no cookie or session.
 */
export function createAudienceSnapshotRoute(deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly store: AudienceSnapshotStore;
  readonly counts: ViewerCounts;
  readonly clock: Pick<Clock, 'now'>;
}) {
  const memo = createSnapshotMemo<AudienceSnapshot | null>({
    nowMs: () => Date.parse(deps.clock.now()),
    ttlMs: SNAPSHOT_TTL_MS,
    maxEntries: SNAPSHOT_ROUNDS,
  });
  return (request: Request, roundId: string) =>
    handleOperation(
      deps.logger,
      request,
      'audience.snapshot',
      async () => {
        const snapshot = await memo(roundId, () =>
          readAudienceSnapshot(deps, { roundId, now: deps.clock.now() }),
        );
        if (snapshot === null)
          return Response.json(
            { error: { code: 'NOT_FOUND' } },
            { status: 404 },
          );
        return Response.json(snapshot, {
          headers: {
            'Cache-Control': PUBLIC_SNAPSHOT_CACHE,
            'X-Robots-Tag': 'noindex',
          },
        });
      },
      deps.reporter,
    );
}

/** The snapshot with what this reader may not see taken out, and what they may. */
export const audienceFor = (
  snapshot: AudienceSnapshot,
  shown: AudienceShown,
): AudienceSnapshot => ({
  ...snapshot,
  messages: shown.chat ? snapshot.messages : [],
  reactions: shown.reactions ? snapshot.reactions : [],
  viewers: shown.viewers ? snapshot.viewers : null,
});

/**
 * A render's read for one viewer. A seat is read only for an account with an
 * actor, and a visitor's read touches nothing about who they are.
 */
export const readAudienceForViewer = async (
  deps: {
    readonly store: AudienceSnapshotStore & Pick<Database, 'readAudienceSeat'>;
    readonly counts: ViewerCounts;
  },
  input: {
    readonly roundId: string;
    readonly actorId: string | null;
    readonly now: string;
  },
) => {
  const snapshot = await readAudienceSnapshot(deps, input);
  if (!snapshot) return null;
  const seat = input.actorId
    ? await deps.store.readAudienceSeat({
        roundId: input.roundId,
        actorId: input.actorId,
      })
    : null;
  const shown = audienceShownTo(seat);
  return {
    snapshot: audienceFor(snapshot, shown),
    shown,
    seated: seat !== null,
  };
};
