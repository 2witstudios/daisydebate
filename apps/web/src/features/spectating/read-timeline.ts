import { spectatorTimelineHorizon } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';
import { idSchema, type SpectatorTimeline } from '@daisy/protocol';
import { audienceAdmits } from '../audience-link/audience-link';
import {
  projectSpectatorTimeline,
  type SpectatorTimelineContext,
} from './timeline';

type Store = Pick<Database, 'readSpectatorTimeline' | 'readRoundAudienceLink'>;

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

/** What one request may read of a Round, or null: refused reads as missing. */
export async function readSpectatorTimeline(
  store: Store,
  input: Parameters<typeof readAudienceSnapshot>[1] & {
    readonly presentedHash: string | null;
  },
): Promise<SpectatorTimeline | null> {
  const snapshot = await readAudienceSnapshot(store, input);
  return snapshot && (await admitAudience(store, snapshot, input))
    ? snapshot.timeline
    : null;
}
