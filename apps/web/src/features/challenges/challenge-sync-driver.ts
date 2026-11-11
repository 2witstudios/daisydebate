import { buildUserInboxTopic, type ChallengeList } from '@daisy/protocol';
import type { Scheduler } from '../realtime/connection-store';
import { attachInvalidationTopic } from '../realtime/invalidation-topic';
import {
  createResourceSyncDriver,
  type Doorbell,
  type ResourceRead,
  type SyncConnection,
  type SyncVisibility,
} from '../resource-sync/driver';
import {
  seedResourceSync,
  type ResourceIdentity,
  type ResourceSync,
} from '../resource-sync/resource-sync';
import {
  challengesHeld,
  holdChallenges,
  type ChallengesEvent,
  type ChallengesHeld,
} from './challenges-held';

/** How often a member with an open offer checks it still stands. */
export const OFFER_WATCH_MS = 5_000;
/** How long the list goes unread when nothing rings and no offer is open. */
export const CHALLENGE_BACKSTOP_MS = 30_000;

/**
 * The list carries no version and belongs to whoever is signed in, so every
 * answer is adopted; the driver's single-flight reads keep answers in order.
 */
const identity: ResourceIdentity<ChallengeList> = {
  id: () => 'challenges',
  version: () => 0,
};

const offersOpen = (list: ChallengeList) =>
  list.outgoing.length > 0 || list.incoming.length > 0;

const inboxDoorbell =
  (actorId: string) =>
  (
    connection: SyncConnection,
    signal: (version: number | null) => void,
  ): Doorbell =>
    attachInvalidationTopic({
      topic: buildUserInboxTopic(actorId),
      connection,
      matches: (frame) =>
        frame.type === 'event' && frame.payload.kind === 'challenge.changed',
      // A ring missed while the socket was down reads on re-subscribing.
      catchUpOnSubscribe: true,
      invalidate: () => {},
      refetch: () => signal(null),
    });
/** With no connection the driver asks for no doorbell. */
const noDoorbell = (): Doorbell => ({
  authorizedSnapshot: () => {},
  close: () => {},
});

export const seedChallengeSync = (
  list: ChallengeList,
  at: number,
): ResourceSync<ChallengesHeld> => ({
  ...seedResourceSync(identity, list, at),
  value: holdChallenges(list),
});

/**
 * Resource sync for a member's challenges (ADR 0103): their inbox doorbell,
 * the list read, and what the tab holds of it. An offer running out rings
 * nobody, so while one is open the list goes out of date by itself.
 */
export function createChallengeSyncDriver({
  seed,
  read,
  inbox,
  scheduler,
  visibility,
}: {
  readonly seed: ChallengeList;
  readonly read: () => Promise<ResourceRead<ChallengeList>>;
  /** The member's inbox, or null without realtime or a member to ring. */
  readonly inbox: {
    readonly actorId: string;
    readonly connection: SyncConnection;
  } | null;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
}) {
  const sync = createResourceSyncDriver({
    identity,
    seed: seedResourceSync(identity, seed, scheduler.now()),
    read,
    scheduler,
    visibility,
    connection: inbox?.connection ?? null,
    doorbell: inbox ? inboxDoorbell(inbox.actorId) : noDoorbell,
    pollMs: { doorbell: CHALLENGE_BACKSTOP_MS, alone: CHALLENGE_BACKSTOP_MS },
    deadline: (state) =>
      offersOpen(state.value) ? state.readAt + OFFER_WATCH_MS : null,
  });
  let listedFrom = seed;
  let snapshot = seedChallengeSync(seed, scheduler.now());
  const listeners = new Set<() => void>();
  const hold = (value: ChallengesHeld) => {
    snapshot = { ...sync.readSnapshot(), value };
    for (const listener of listeners) listener();
  };
  const apply = (event: ChallengesEvent) => {
    const next = challengesHeld(snapshot.value, event);
    if (next !== snapshot.value) hold(next);
  };
  sync.subscribe(() => {
    const list = sync.readSnapshot().value;
    if (list === listedFrom) return hold(snapshot.value);
    listedFrom = list;
    hold(challengesHeld(snapshot.value, { type: 'listed', list }));
  });
  return {
    readSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Reads at once, after the member's own action. */
    refresh: sync.signal,
    /** The member is ending this offer, so its end needs no notice. */
    cancelling: (id: string) => apply({ type: 'cancelling', id }),
    cancelRefused: (id: string) => apply({ type: 'cancel-refused', id }),
    dismiss: (id: string) => apply({ type: 'dismissed', id }),
    dispose() {
      listeners.clear();
      sync.dispose();
    },
  };
}
