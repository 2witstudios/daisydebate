import { buildDebateTopic, type RoundTranscriptRead } from '@daisy/protocol';
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
        topic: buildDebateTopic(input.seed.value.round.id),
        kind: 'debate.transcript-changed',
        id: input.seed.value.round.id,
        connection,
        signal,
      }),
  });
}
