import { buildRoundTopic, type RoundView } from '@daisy/protocol';
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
 * Rounds order by their persisted revision. A running Round's position is
 * derived from the held round on the client each second; its opening goes out
 * of date by itself at its strike and prep deadlines. What a played Round is
 * waiting on can change with no revision, when a judging job fails, so that
 * state can lag by up to the resource sync's 30 s backstop poll.
 */
const roundIdentity: ResourceIdentity<RoundView> = {
  id: (round) => round.id,
  version: (round) => round.version,
};

export type RoundSync = ResourceSync<RoundView>;

export const seedRoundSync = (round: RoundView, at: number): RoundSync =>
  seedResourceSync(roundIdentity, round, at);

/**
 * When the opening's strike or prep runs out by the read's own account, the
 * Round must be read again, even with no doorbell. A step with no time left
 * has nothing more to wait for: the backstop picks it up, so a read at zero
 * never schedules another.
 */
export function openingDeadline(state: RoundSync): number | null {
  const opening = state.value.opening;
  const remaining =
    opening?.step.step === 'prep'
      ? opening.step.remainingMs
      : opening?.step.step === 'strike'
        ? (opening.draw?.turn?.remainingMs ?? 0)
        : 0;
  return remaining > 0 ? state.readAt + remaining : null;
}

/** Resource sync for a live round (ADR 0066): its `round:<id>` doorbell and read. */
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
    deadline: openingDeadline,
    ...(onConnectionOpen ? { onConnectionOpen } : {}),
    doorbell: (subscribed, signal) =>
      attachVersionDoorbell({
        topic: buildRoundTopic(seed.value.id),
        kind: 'round.phase-changed',
        id: seed.value.id,
        connection: subscribed,
        signal,
      }),
  });
}
