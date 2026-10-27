import { buildDebateTopic, type RoundView } from '@daisy/protocol';
import type { Scheduler } from '../realtime/connection-store';
import {
  createResourceSyncDriver,
  type SyncConnection,
  type SyncVisibility,
} from '../resource-sync/driver';
import { attachVersionDoorbell } from '../resource-sync/doorbell';
import {
  seedResourceSync,
  type ResourceIdentity,
  type ResourceSync,
} from '../resource-sync/resource-sync';
import type { RoundRead } from './read-round';

/**
 * Rounds order by their persisted revision. The live position is derived
 * from the held round on the client each second, so nothing in the round
 * goes out of date by itself between revisions.
 */
const roundIdentity: ResourceIdentity<RoundView> = {
  id: (round) => round.id,
  version: (round) => round.version,
};

export type RoundSync = ResourceSync<RoundView>;

export const seedRoundSync = (round: RoundView, at: number): RoundSync =>
  seedResourceSync(roundIdentity, round, at);

/** Resource sync for a live round (ADR 0066): its `debate:<id>` doorbell and read. */
export function createRoundSyncDriver({
  seed,
  read,
  scheduler,
  visibility,
  connection,
  onConnectionOpen,
}: {
  readonly seed: RoundSync;
  readonly read: () => Promise<RoundRead>;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
  readonly onConnectionOpen?: () => void;
  readonly connection: SyncConnection | null;
}) {
  return createResourceSyncDriver({
    identity: roundIdentity,
    seed,
    read: async () => {
      const answer = await read();
      return answer.kind === 'found'
        ? { kind: 'found', value: answer.round }
        : answer;
    },
    scheduler,
    visibility,
    connection,
    ...(onConnectionOpen ? { onConnectionOpen } : {}),
    doorbell: (subscribed, signal) =>
      attachVersionDoorbell({
        topic: buildDebateTopic(seed.value.id),
        kind: 'debate.phase-changed',
        id: seed.value.id,
        connection: subscribed,
        signal,
      }),
  });
}
