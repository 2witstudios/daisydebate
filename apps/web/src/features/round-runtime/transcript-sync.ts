import { buildRoundTopic, type RoundTranscriptRead } from '@daisy/protocol';
import { createResourceSyncDriver } from '../resource-sync/driver';
import type { ResourceRead } from '../resource-sync/driver';
import { attachVersionDoorbell } from '../resource-sync/doorbell';
import { seedResourceSync } from '../resource-sync/resource-sync';
import type { ResourceIdentity } from '../resource-sync/resource-sync';

const identity: ResourceIdentity<RoundTranscriptRead> = {
  id: (value) => value.round.id,
  version: (value) => value.revision,
};
export const seedTranscript = (value: RoundTranscriptRead) =>
  seedResourceSync(identity, value, 0);
/** Text and stream closure move independently of competitive Round revisions. */
export function createTranscriptSync(
  input: Omit<
    Parameters<typeof createResourceSyncDriver<RoundTranscriptRead>>[0],
    'identity' | 'doorbell' | 'pollMs' | 'read'
  > & {
    readonly read: () => Promise<ResourceRead<RoundTranscriptRead>>;
  },
) {
  return createResourceSyncDriver({
    ...input,
    identity,
    pollMs: { doorbell: null, alone: 30000 },
    doorbell: (connection, signal) =>
      attachVersionDoorbell({
        topic: buildRoundTopic(input.seed.value.round.id),
        kind: 'round.transcript-changed',
        catchUpOnSubscribe: true,
        id: input.seed.value.round.id,
        connection,
        signal,
      }),
  });
}

type TranscriptSyncEdges = Omit<
  Parameters<typeof createTranscriptSync>[0],
  'seed' | 'read'
>;
/**
 * Holds one Round's transcript across its sync drivers: a replaced driver
 * starts from the newest text held, a later server render's seed never replaces
 * newer text, and a real refusal stays final whatever render arrives after it.
 */
export function createTranscriptHolder(
  seed: RoundTranscriptRead,
  read: () => Promise<ResourceRead<RoundTranscriptRead>>,
) {
  let held = seed;
  let gone = false;
  let current: ReturnType<typeof createTranscriptSync> | null = null;
  return {
    seed: () => seedTranscript(held),
    start(edges: TranscriptSyncEdges) {
      const started = seedTranscript(held);
      const running = createTranscriptSync({
        ...edges,
        read,
        seed: gone ? { ...started, freshness: 'gone' } : started,
      });
      current = running;
      running.subscribe(() => {
        const state = running.readSnapshot();
        held = state.value;
        gone = state.freshness === 'gone';
      });
      return running;
    },
    offer(next: RoundTranscriptRead) {
      if (gone || next.round.id !== held.round.id) return;
      if (next.revision >= held.revision) held = next;
      current?.accepted(next);
    },
  };
}
