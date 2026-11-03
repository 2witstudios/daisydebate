import { spectatorTimelineHorizon } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';
import { idSchema, type SpectatorTimeline } from '@daisy/protocol';
import { projectSpectatorTimeline } from './timeline';

type Store = Pick<Database, 'readSpectatorTimeline'>;

/**
 * A Round's released timeline at `now`, or null when it has no audience. It
 * takes no viewer: everyone reads the same facts, so a participant or host
 * gets nothing here they could not read as a visitor.
 */
export async function readSpectatorTimeline(
  store: Store,
  input: { readonly roundId: string; readonly now: string },
): Promise<SpectatorTimeline | null> {
  if (!idSchema.safeParse(input.roundId).success) return null;
  const nowMs = Date.parse(input.now);
  const read = await store.readSpectatorTimeline({
    roundId: input.roundId,
    horizonOf: (facts) => spectatorTimelineHorizon({ ...facts, nowMs }),
  });
  return read && projectSpectatorTimeline(read);
}
