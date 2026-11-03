import type { Clock } from '@daisy/clock';
import { spectatorTimelineHorizon } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';
import { isTemporaryRefusal } from '@daisy/db/capacity';
import { idSchema, type SpectatorTimeline } from '@daisy/protocol';
import { audienceAdmits } from '../audience-link/audience-link';
import { createSnapshotMemo } from './snapshot-memo';
import {
  projectSpectatorTimeline,
  type SpectatorTimelineContext,
} from '@daisy/debate-engine';

type Store = Pick<Database, 'readSpectatorTimeline' | 'readRoundAudienceLink'>;

const SNAPSHOT_TTL_MS = 1000;
const SNAPSHOT_ROUNDS = 5000;

/** A Round's released timeline, not yet admitted to anyone. */
export type AudienceSnapshot = {
  readonly visibility: 'public' | 'unlisted';
  readonly timeline: SpectatorTimeline;
};

/**
 * A Round's released timeline at `now`, or null when it has no audience. It
 * takes no viewer: everyone reads the same facts, so a participant or host
 * gets nothing here they could not read as a visitor. Safe to share between
 * readers, and never to answer one without `admitAudience`.
 */
export async function readAudienceSnapshot(
  store: Pick<Store, 'readSpectatorTimeline'>,
  input: {
    readonly roundId: string;
    readonly now: string;
    readonly feedUrlOf: SpectatorTimelineContext['feedUrlOf'];
  },
): Promise<AudienceSnapshot | null> {
  if (!idSchema.safeParse(input.roundId).success) return null;
  const nowMs = Date.parse(input.now);
  const read = await store.readSpectatorTimeline({
    roundId: input.roundId,
    horizonOf: (facts) => spectatorTimelineHorizon({ ...facts, nowMs }),
  });
  const visibility = read?.round.visibility;
  if (!read || (visibility !== 'public' && visibility !== 'unlisted'))
    return null;
  return {
    visibility,
    timeline: projectSpectatorTimeline(read, {
      nowMs,
      feedUrlOf: input.feedUrlOf,
    }),
  };
}

/**
 * Whether this request may have the snapshot. A public Round costs no read, so a
 * crowd stays one reader. An unlisted one reads its link fresh on every request,
 * never through a memo, so replacing the link refuses the old one at once.
 */
export const admitAudience = async (
  store: Pick<Store, 'readRoundAudienceLink'>,
  snapshot: Pick<AudienceSnapshot, 'visibility'>,
  input: { readonly roundId: string; readonly presentedHash: string | null },
): Promise<boolean> => {
  if (snapshot.visibility === 'public') return true;
  if (input.presentedHash === null) return false;
  const link = await store.readRoundAudienceLink(input.roundId);
  return link !== null && audienceAdmits(link, input.presentedHash);
};

/**
 * A Round's snapshot held for a second, with its one serialization, so a crowd
 * costs one read and one stringify per Round per second. Keyed by Round alone and
 * holding no link: admission happens after it. A full lane's refusal holds for the
 * same second, so a crowd asks it once.
 */
export const createWatchRoundSnapshots = (deps: {
  readonly store: Pick<Store, 'readSpectatorTimeline'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly feedUrlOf: SpectatorTimelineContext['feedUrlOf'];
}) => {
  const memo = createSnapshotMemo<
    (AudienceSnapshot & { readonly body: string }) | null
  >({
    nowMs: () => Date.parse(deps.clock.now()),
    ttlMs: SNAPSHOT_TTL_MS,
    maxEntries: SNAPSHOT_ROUNDS,
    keepsFailure: isTemporaryRefusal,
  });
  // A malformed id reads as missing before it can take a place in the memo.
  return async (roundId: string) =>
    !idSchema.safeParse(roundId).success
      ? null
      : memo(roundId, async () => {
          const snapshot = await readAudienceSnapshot(deps.store, {
            roundId,
            now: deps.clock.now(),
            feedUrlOf: deps.feedUrlOf,
          });
          return (
            snapshot && { ...snapshot, body: JSON.stringify(snapshot.timeline) }
          );
        });
};
