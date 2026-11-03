import { createRoundRuntime, plannedBroadcast } from '@daisy/debate-engine';
import type { createDatabase } from '@daisy/db';
import { broadcastHoldPrefix, holdAttemptPrefix } from '@daisy/protocol';
import { createSweepPass } from '../../lib/sweep-pass';
import { reconcileFacts } from './reconcile-facts';
import { releaseOverdue } from './release-lag';
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
/** Long enough for any start; a crash inside one delays the next by this much. */
const START_LEASE_MS = 15_000;

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
  /** CSPRNG name of the public object tree: public media is found by no other way. */
  readonly newFeedKey: () => string;
  /** CSPRNG secret; only its SHA3-256 hash is stored. */
  readonly newCredential: () => { secret: string; hash: string };
  readonly stageUrl: (broadcastId: string, credential: string) => string;
  readonly report: (
    event:
      | Parameters<ReconcilePorts['report']>[0]
      | 'broadcast.reconcile_failed'
      | 'broadcast.release_delayed',
  ) => void;
  /** Resolves when a pass has waited long enough for its slowest Broadcast. */
  readonly passBudget?: () => Promise<void>;
}) => {
  const overdue = new Set<string>();
  /** Reported once per stretch: this runs each pass, and the alert is the crossing. */
  const watchRelease = (
    broadcast: Awaited<ReturnType<Store['listOpen']>>[number],
  ) => {
    if (!releaseOverdue(broadcast, deps.now()))
      return void overdue.delete(broadcast.id);
    if (overdue.has(broadcast.id)) return;
    overdue.add(broadcast.id);
    deps.report('broadcast.release_delayed');
  };
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
        holdClaim: () =>
          deps.store.holdReconcile({
            id,
            until: new Date(nowMs + START_LEASE_MS),
          }),
        releaseClaim: () => deps.store.holdReconcile({ id, until: null }),
        startEgress: () =>
          deps.egress.start({
            stageUrl: deps.stageUrl(id, credential.secret),
            holdPrefix: holdAttemptPrefix(broadcastHoldPrefix(id), generation),
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
  const pass = createSweepPass(deps.passBudget);
  const sweep = async () => {
    for (const round of await deps.store.discoverUnopened(BATCH)) {
      const plan = plannedBroadcast(round);
      if (plan)
        await deps.store.open({
          id: deps.nextId(),
          roundId: round.roundId,
          feedKey: deps.newFeedKey(),
          ...plan,
        });
    }
    await pass.overPages(
      BATCH,
      (after) => deps.store.listOpen(BATCH, after),
      (broadcast) => broadcast.id,
      async (broadcast) => {
        const nowMs = deps.now();
        const mine = await deps.store.claimReconcile({
          id: broadcast.id,
          now: new Date(nowMs),
          until: new Date(nowMs + RECONCILE_LEASE_MS),
        });
        if (!mine) return;
        watchRelease(broadcast);
        await reconcile(broadcast);
      },
      () => deps.report('broadcast.reconcile_failed'),
    );
  };
  return Object.assign(sweep, { settled: pass.settled });
};
