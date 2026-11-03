import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { isTemporaryRefusal } from '@daisy/db/capacity';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import {
  audienceReactionKinds,
  idSchema,
  type AudienceReactionKind,
  type AudienceSnapshot,
} from '@daisy/protocol';
import type { Identity } from '@daisy/auth';
import { handleOperation, PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { presentedLinkHash } from '../audience-link/audience-link';
import { latestViewerBucket } from '../viewer-counts/viewer-count';
import { joinReadInFlight } from './in-flight-read';
import { admitAudience } from './read-timeline';
import { answerUnlessRefused } from './refused-read';
import { createSnapshotMemo } from './snapshot-memo';
import { audienceShownTo, type AudienceShown } from './seated-audience';

const SNAPSHOT_TTL_MS = 1000;
const SNAPSHOT_ROUNDS = 5000;

type Read = NonNullable<Awaited<ReturnType<Database['readAudienceSnapshot']>>>;

/** Every reaction kind in its order, with zero for one nobody has used. */
const reactionTotals = (read: Read): AudienceSnapshot['reactions'] =>
  audienceReactionKinds.map((kind: AudienceReactionKind) => ({
    kind,
    count: read.reactions.find((row) => row.kind === kind)?.count ?? 0,
  }));

/** A zero count is no count: nothing to say. */
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

/** A Round's audience as it stands, not yet admitted to anyone. */
export type AudienceRead = {
  readonly visibility: 'public' | 'unlisted';
  readonly snapshot: AudienceSnapshot;
};

/**
 * Near real time, through moderation alone, for everyone on the shared feed (ADR
 * 0108). A count only while a Broadcast is on. A lost count must not take the rest
 * with it: Redis is expendable (AGENTS.md), and a count drives nothing. Null when
 * the Round has no audience. Never answer one without `admitAudience`.
 */
export const readAudienceSnapshot = async (
  deps: {
    readonly store: AudienceSnapshotStore;
    readonly counts: ViewerCounts;
  },
  input: { readonly roundId: string; readonly now: string },
): Promise<AudienceRead | null> => {
  if (!idSchema.safeParse(input.roundId).success) return null;
  const read = await deps.store.readAudienceSnapshot({
    roundId: input.roundId,
  });
  if (!read) return null;
  const viewers = read.open
    ? await deps.counts
        .readViewerCount(
          input.roundId,
          latestViewerBucket(Date.parse(input.now)),
        )
        .catch(() => null)
    : null;
  return {
    visibility: read.visibility,
    snapshot: projectAudienceSnapshot(input.roundId, read, viewers),
  };
};

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

type AdmissionStore = Parameters<typeof admitAudience>[0] &
  Pick<Database, 'readLiveRoomStanding'>;

/**
 * GET /api/rounds/:id/audience. A public Round answers everyone alike and may be
 * cached, with no cookie or session read. An unlisted one is never cached and
 * reads its link fresh on each request; failing that, someone in its live room is
 * shown what their place allows, since a host or a seat needs no link. Anyone else
 * reads it as missing.
 */
export function createAudienceSnapshotRoute(deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly store: AudienceSnapshotStore & AdmissionStore;
  readonly counts: ViewerCounts;
  readonly clock: Pick<Clock, 'now'>;
  readonly identify: (request: Request) => Promise<Identity>;
  /** The per-client limit; it runs before any read. */
  readonly limitRead?: (request: Request) => Promise<unknown>;
}) {
  // Keyed by Round alone and holding no link: admission happens after it. The
  // body is the one serialization a crowd shares; a reader's own view is apart.
  const memo = createSnapshotMemo<{
    readonly read: AudienceRead;
    readonly body: string;
  } | null>({
    nowMs: () => Date.parse(deps.clock.now()),
    ttlMs: SNAPSHOT_TTL_MS,
    maxEntries: SNAPSHOT_ROUNDS,
    keepsFailure: isTemporaryRefusal,
  });
  const readShared = async (roundId: string) => {
    const read = await readAudienceSnapshot(deps, {
      roundId,
      now: deps.clock.now(),
    });
    return read && { read, body: JSON.stringify(read.snapshot) };
  };
  const links =
    joinReadInFlight<
      Awaited<ReturnType<AdmissionStore['readRoundAudienceLink']>>
    >();
  const linkStore = {
    readRoundAudienceLink: (roundId: string) =>
      links(roundId, () => deps.store.readRoundAudienceLink(roundId)),
  };
  const shownToLiveRoom = async (request: Request, roundId: string) => {
    const identity = await deps.identify(request);
    const actorId =
      'principal' in identity && identity.principal.kind === 'user'
        ? identity.principal.actorId
        : null;
    const standing = actorId
      ? await deps.store.readLiveRoomStanding({ roundId, actorId })
      : null;
    return standing ? audienceShownTo(standing) : null;
  };
  const notFound = () =>
    Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  return (request: Request, roundId: string) =>
    handleOperation(
      deps.logger,
      request,
      'audience.snapshot',
      () =>
        answerUnlessRefused(async () => {
          await deps.limitRead?.(request);
          // A malformed id reads as missing before it can take a place in the memo.
          if (!idSchema.safeParse(roundId).success) return notFound();
          const shared = await memo(roundId, () => readShared(roundId));
          if (shared === null) return notFound();
          const { read, body } = shared;
          if (read.visibility === 'public')
            return new Response(body, {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': PUBLIC_SNAPSHOT_CACHE,
                'X-Robots-Tag': 'noindex',
              },
            });
          // handleOperation answers anything uncached no-store.
          const noindex = { 'X-Robots-Tag': 'noindex' };
          if (
            await admitAudience(linkStore, read, {
              roundId,
              presentedHash: presentedLinkHash(
                request.headers.get('cookie'),
                roundId,
              ),
            })
          )
            return new Response(body, {
              headers: { 'Content-Type': 'application/json', ...noindex },
            });
          const shown = await shownToLiveRoom(request, roundId);
          return shown
            ? Response.json(audienceFor(read.snapshot, shown), {
                headers: noindex,
              })
            : notFound();
        }),
      deps.reporter,
    );
}

/**
 * A render's read for one viewer, or null when they cannot reach the Round. A
 * standing is read only for an account with an actor, and a visitor's read touches
 * nothing about who they are. Someone in the live room needs no link to it.
 */
export const readAudienceForViewer = async (
  deps: {
    readonly store: AudienceSnapshotStore & AdmissionStore;
    readonly counts: ViewerCounts;
  },
  input: {
    readonly roundId: string;
    readonly actorId: string | null;
    readonly presentedHash: string | null;
    readonly now: string;
  },
) => {
  const read = await readAudienceSnapshot(deps, input);
  if (!read) return null;
  const standing = input.actorId
    ? await deps.store.readLiveRoomStanding({
        roundId: input.roundId,
        actorId: input.actorId,
      })
    : null;
  if (standing === null && !(await admitAudience(deps.store, read, input)))
    return null;
  const shown = audienceShownTo(standing);
  return {
    snapshot: audienceFor(read.snapshot, shown),
    shown,
    seated: standing?.kind === 'seat',
    inLiveRoom: standing !== null,
    unlisted: read.visibility === 'unlisted',
  };
};
