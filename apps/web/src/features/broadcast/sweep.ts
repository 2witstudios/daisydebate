import { createRoundRuntime, plannedBroadcast } from '@daisy/debate-engine';
import type { createDatabase } from '@daisy/db';
import { reconcileFacts } from './reconcile-facts';
import { reconcileStep, type ReconcilePorts } from './reconcile-step';

type Database = ReturnType<typeof createDatabase>;
type Store = Database['broadcasts'];
type Egress = {
  readonly start: (input: {
    readonly stageUrl: string;
    readonly holdPrefix: string;
    readonly segmentSeconds: number;
  }) => Promise<string>;
  readonly stop: (id: string) => Promise<void>;
  readonly read: (
    id: string,
  ) => Promise<Parameters<typeof reconcileFacts>[0]['egress']>;
  readonly revokeObserver: (room: string) => Promise<unknown>;
  readonly restoreObserver: (room: string) => Promise<unknown>;
};

const SEGMENT_SECONDS = 4;
const BATCH = 64;
const RECONCILE_LEASE_MS = 800;

/**
 * One pass over every open Broadcast. It reads the Round without a lock and
 * without ticking it, and a failure on one Broadcast never stops the others or
 * reaches a Round.
 */
export const createBroadcastSweep = (deps: {
  readonly store: Store;
  readonly egress: Egress;
  readonly now: () => number;
  readonly nextId: () => string;
  /** CSPRNG secret; only its SHA3-256 hash is stored. */
  readonly newCredential: () => { secret: string; hash: string };
  readonly stageUrl: (broadcastId: string, credential: string) => string;
  readonly report: (
    event:
      Parameters<ReconcilePorts['report']>[0] | 'broadcast.reconcile_failed',
  ) => void;
}) => {
  const reconcile = async (
    broadcast: Awaited<ReturnType<Store['listOpen']>>[number],
  ) => {
    const read = await deps.store.readRound(broadcast.roundId);
    if (!read) return;
    const nowMs = deps.now();
    const position = createRoundRuntime({
      ...read.round,
      round: read.round,
      nextSegmentId: deps.nextId,
    }).position(new Date(nowMs).toISOString());
    const egress = broadcast.egressId
      ? await deps.egress.read(broadcast.egressId)
      : ({ kind: 'none' } as const);
    const room = read.roomName;
    const id = broadcast.id;
    const credential = deps.newCredential();
    const generation = broadcast.egressGeneration + 1;
    await reconcileStep(
      reconcileFacts({
        nowMs,
        broadcast,
        roundStatus: read.round.status,
        roundEndedAt: read.endedAt,
        position,
        lastSequence: read.round.rules.segments.length - 1,
        egress,
      }),
      {
        startEgress: () =>
          deps.egress.start({
            stageUrl: deps.stageUrl(id, credential.secret),
            holdPrefix: `hold/${id}/${generation}/`,
            segmentSeconds: SEGMENT_SECONDS,
          }),
        recordEgressStarted: (egressId) =>
          deps.store.recordEgressStarted({
            id,
            egressId,
            generation,
            stageCredentialHash: credential.hash,
            now: new Date(nowMs),
          }),
        stopEgress: (egressId) => deps.egress.stop(egressId),
        revokeObserver: async () => {
          if (room) await deps.egress.revokeObserver(room);
        },
        recordRevoked: () =>
          deps.store.recordObserverRevoked({ id, now: new Date(nowMs) }),
        recordRevocationFailed: () => deps.store.recordRevocationFailed(id),
        restoreObserver: async () => {
          if (room) await deps.egress.restoreObserver(room);
        },
        recordRestored: () => deps.store.recordObserverRestored(id),
        recordFinalMediaEnd: () =>
          deps.store.recordFinalMediaEnd({ id, at: new Date(nowMs) }),
        complete: () => deps.store.complete({ id, at: new Date(nowMs) }),
        report: deps.report,
      },
    );
  };
  return async () => {
    for (const round of await deps.store.discoverUnopened(BATCH)) {
      const plan = plannedBroadcast(round);
      if (plan)
        await deps.store.open({
          id: deps.nextId(),
          roundId: round.roundId,
          ...plan,
        });
    }
    for (const broadcast of await deps.store.listOpen(BATCH)) {
      const nowMs = deps.now();
      const mine = await deps.store.claimReconcile({
        id: broadcast.id,
        now: new Date(nowMs),
        until: new Date(nowMs + RECONCILE_LEASE_MS),
      });
      if (mine)
        await reconcile(broadcast).catch(() =>
          deps.report('broadcast.reconcile_failed'),
        );
    }
  };
};
