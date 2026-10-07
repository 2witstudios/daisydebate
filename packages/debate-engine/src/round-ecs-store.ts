import { Database } from '@adobe/data/ecs';
import {
  emptyRuntimeCheckpoint,
  runtimeCheckpointSchema,
  type DebateSide,
  type RuntimeCheckpoint,
  type SegmentType,
} from '@daisy/protocol';
import { plugin, type Lifecycle } from './round-ecs-plugin';

/**
 * The runtime's execution substrate (ADR 0058 §6): Adobe ECS storage inside
 * the engine's adapter, the one workspace the isolation boundary allows.
 * Segment rows are entities; the round lifecycle and the checkpoint are
 * resources. Nothing here is ever persisted — durable truth is the rows the
 * runtime projects, and this store dies with the process.
 *
 * The API speaks only Daisy data. Vendor types never cross it.
 */

type StoreRow = {
  readonly id: string;
  readonly sequence: number;
  readonly type: SegmentType;
  readonly key: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
};

export type RoundStore = {
  readonly rows: () => readonly StoreRow[];
  readonly lifecycle: () => Lifecycle;
  readonly checkpoint: () => RuntimeCheckpoint;
  readonly openRow: () => StoreRow | undefined;
  readonly insertSegment: (row: {
    readonly id: string;
    readonly sequence: number;
    readonly type: SegmentType;
    readonly key: string;
    readonly startedAtMs: number;
    readonly durationMs: number;
  }) => void;
  readonly closeSegment: (input: {
    readonly id: string;
    readonly endedAtMs: number;
  }) => void;
  readonly setLifecycle: (lifecycle: Partial<Lifecycle>) => void;
  readonly setPrepConsumed: (side: DebateSide, ms: number) => void;
  readonly startPrep: (input: {
    readonly side: DebateSide;
    readonly startedAtMs: number;
  }) => void;
  readonly endPrep: () => void;
  readonly setFloor: (input: {
    readonly participantId: string;
    readonly grantedAtMs: number;
  }) => void;
  readonly clearFloor: () => void;
};

const hydrate = (
  lifecycle: Lifecycle,
  checkpoint: RuntimeCheckpoint,
  rows: readonly StoreRow[],
): RoundStore => {
  const db = Database.create(plugin);
  db.transactions.setLifecycle(lifecycle);
  db.transactions.setCheckpoint(checkpoint);
  for (const row of rows)
    db.transactions.insertSegment({
      id: row.id,
      sequence: row.sequence,
      type: row.type,
      key: row.key,
      startedAtMs: row.startedAtMs,
      durationMs: row.durationMs,
      endedAtMs: row.endedAtMs,
    });
  const readRows = (): readonly StoreRow[] =>
    db
      .select([
        'segmentId',
        'sequence',
        'segmentType',
        'segmentKey',
        'startedAtMs',
        'endedAtMs',
        'durationMs',
      ])
      .map((entity) => {
        const segmentId = db.get(entity, 'segmentId');
        const sequence = db.get(entity, 'sequence');
        const segmentType = db.get(entity, 'segmentType');
        const segmentKey = db.get(entity, 'segmentKey');
        const startedAtMs = db.get(entity, 'startedAtMs');
        const endedAtMs = db.get(entity, 'endedAtMs');
        const durationMs = db.get(entity, 'durationMs');
        if (
          segmentId === undefined ||
          sequence === undefined ||
          segmentType === undefined ||
          segmentKey === undefined ||
          startedAtMs === undefined ||
          endedAtMs === undefined ||
          durationMs === undefined
        )
          throw new Error('ECS segment storage is incomplete');
        return {
          id: segmentId,
          sequence,
          type: segmentType,
          key: segmentKey,
          startedAtMs,
          endedAtMs,
          durationMs,
        };
      })
      .sort((a, b) => a.sequence - b.sequence);
  return {
    rows: readRows,
    lifecycle: () => ({
      status: db.resources.status,
      startedAtMs: db.resources.startedAtMs,
      completedAtMs: db.resources.completedAtMs,
      outcome: db.resources.outcome,
      gapAnchorMs: db.resources.gapAnchorMs,
    }),
    checkpoint: () => {
      const side = db.resources.activePrepSide;
      const prepStartedAtMs = db.resources.activePrepStartedAtMs;
      const floorId = db.resources.floorParticipantId;
      const floorGrantedAtMs = db.resources.floorGrantedAtMs;
      return {
        version: 1,
        prep_consumed_ms: {
          affirmative: db.resources.prepConsumedAffirmativeMs,
          negative: db.resources.prepConsumedNegativeMs,
        },
        active_prep:
          side === null || prepStartedAtMs === null
            ? null
            : { side, started_at: new Date(prepStartedAtMs).toISOString() },
        floor:
          floorId === null || floorGrantedAtMs === null
            ? null
            : {
                holder_participant_id: floorId,
                granted_at: new Date(floorGrantedAtMs).toISOString(),
              },
      };
    },
    openRow: () => readRows().find((row) => row.endedAtMs === null),
    insertSegment: (row) =>
      db.transactions.insertSegment({
        id: row.id,
        sequence: row.sequence,
        type: row.type,
        key: row.key,
        startedAtMs: row.startedAtMs,
        durationMs: row.durationMs,
      }),
    closeSegment: (input) => db.transactions.closeSegment(input),
    setLifecycle: (lifecycle) => {
      const current = {
        status: db.resources.status,
        startedAtMs: db.resources.startedAtMs,
        completedAtMs: db.resources.completedAtMs,
        outcome: db.resources.outcome,
        gapAnchorMs: db.resources.gapAnchorMs,
      };
      db.transactions.setLifecycle({ ...current, ...lifecycle });
    },
    setPrepConsumed: (side, ms) =>
      db.transactions.setPrepConsumed({ side, ms }),
    startPrep: ({ side, startedAtMs }) =>
      db.transactions.startPrep({ side, startedAtMs }),
    endPrep: () => db.transactions.endPrep(),
    setFloor: ({ participantId, grantedAtMs }) =>
      db.transactions.setFloor({ participantId, grantedAtMs }),
    clearFloor: () => db.transactions.clearFloor(),
  };
};

/** Opens a store hydrated from durable inputs, checkpoint validated first. */
export const createRoundStore = (input: {
  readonly lifecycle: Lifecycle;
  readonly checkpoint: unknown;
  readonly rows: readonly StoreRow[];
}): RoundStore =>
  hydrate(
    input.lifecycle,
    runtimeCheckpointSchema.parse(input.checkpoint ?? emptyRuntimeCheckpoint),
    input.rows,
  );

/** A capture of the whole store, for restoring after a refused command. */
export type RoundStoreCapture = {
  readonly lifecycle: Lifecycle;
  readonly checkpoint: RuntimeCheckpoint;
  readonly rows: readonly StoreRow[];
};

export const captureRoundStore = (store: RoundStore): RoundStoreCapture => ({
  lifecycle: store.lifecycle(),
  checkpoint: runtimeCheckpointSchema.parse(store.checkpoint()),
  rows: store.rows(),
});

export const restoreRoundStore = (capture: RoundStoreCapture): RoundStore =>
  createRoundStore(capture);
