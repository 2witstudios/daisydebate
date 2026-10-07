import { Database } from '@adobe/data/ecs';
import { Schema } from '@adobe/data/schema';
import {
  debateSides,
  emptyRuntimeCheckpoint,
  roundStatuses,
  runtimeCheckpointSchema,
  segmentTypes,
  type DebateSide,
  type RatedOutcome,
  type RoundStatus,
  type RuntimeCheckpoint,
  type SegmentType,
} from '@daisy/protocol';

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

type Lifecycle = {
  readonly status: RoundStatus;
  readonly startedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly outcome: RatedOutcome | null;
  readonly gapAnchorMs: number | null;
};

const plugin = Database.Plugin.create({
  components: {
    segmentId: { type: 'string' },
    sequence: { type: 'number' },
    segmentType: { enum: segmentTypes },
    segmentKey: { type: 'string' },
    startedAtMs: { type: 'number' },
    endedAtMs: Schema.Nullable({ type: 'number' }),
    durationMs: { type: 'number' },
  },
  resources: {
    status: { enum: roundStatuses, default: 'scheduled' },
    startedAtMs: { ...Schema.Nullable({ type: 'number' }), default: null },
    completedAtMs: { ...Schema.Nullable({ type: 'number' }), default: null },
    outcome: {
      ...Schema.Nullable({
        enum: ['affirmative', 'negative', 'draw'] as const,
      }),
      default: null,
    },
    gapAnchorMs: { ...Schema.Nullable({ type: 'number' }), default: null },
    prepConsumedAffirmativeMs: { type: 'number', default: 0 },
    prepConsumedNegativeMs: { type: 'number', default: 0 },
    activePrepSide: {
      ...Schema.Nullable({ enum: debateSides }),
      default: null,
    },
    activePrepStartedAtMs: {
      ...Schema.Nullable({ type: 'number' }),
      default: null,
    },
    floorParticipantId: {
      ...Schema.Nullable({ type: 'string' }),
      default: null,
    },
    floorGrantedAtMs: { ...Schema.Nullable({ type: 'number' }), default: null },
  },
  archetypes: {
    segment: [
      'segmentId',
      'sequence',
      'segmentType',
      'segmentKey',
      'startedAtMs',
      'endedAtMs',
      'durationMs',
    ],
  },
  transactions: {
    insertSegment: (
      store,
      row: {
        id: string;
        sequence: number;
        type: SegmentType;
        key: string;
        startedAtMs: number;
        durationMs: number;
        endedAtMs?: number | null;
      },
    ) => {
      store.archetypes.segment.insert({
        segmentId: row.id,
        sequence: row.sequence,
        segmentType: row.type,
        segmentKey: row.key,
        startedAtMs: row.startedAtMs,
        endedAtMs: row.endedAtMs ?? null,
        durationMs: row.durationMs,
      });
    },
    closeSegment: (store, input: { id: string; endedAtMs: number }) => {
      const entity = store
        .select(['segmentId'])
        .find((e) => store.get(e, 'segmentId') === input.id);
      if (entity !== undefined)
        store.update(entity, { endedAtMs: input.endedAtMs });
    },
    setLifecycle: (store, lifecycle: Lifecycle) => {
      store.resources.status = lifecycle.status;
      store.resources.startedAtMs = lifecycle.startedAtMs;
      store.resources.completedAtMs = lifecycle.completedAtMs;
      store.resources.outcome = lifecycle.outcome;
      store.resources.gapAnchorMs = lifecycle.gapAnchorMs;
    },
    setCheckpoint: (store, checkpoint: RuntimeCheckpoint) => {
      store.resources.prepConsumedAffirmativeMs =
        checkpoint.prep_consumed_ms.affirmative;
      store.resources.prepConsumedNegativeMs =
        checkpoint.prep_consumed_ms.negative;
      store.resources.activePrepSide = checkpoint.active_prep?.side ?? null;
      store.resources.activePrepStartedAtMs =
        checkpoint.active_prep === null
          ? null
          : Date.parse(checkpoint.active_prep.started_at);
      store.resources.floorParticipantId =
        checkpoint.floor?.holder_participant_id ?? null;
      store.resources.floorGrantedAtMs =
        checkpoint.floor === null
          ? null
          : Date.parse(checkpoint.floor.granted_at);
    },
    setPrepConsumed: (store, input: { side: DebateSide; ms: number }) => {
      if (input.side === 'affirmative')
        store.resources.prepConsumedAffirmativeMs = input.ms;
      else store.resources.prepConsumedNegativeMs = input.ms;
    },
    startPrep: (store, input: { side: DebateSide; startedAtMs: number }) => {
      store.resources.activePrepSide = input.side;
      store.resources.activePrepStartedAtMs = input.startedAtMs;
    },
    endPrep: (store) => {
      store.resources.activePrepSide = null;
      store.resources.activePrepStartedAtMs = null;
    },
    setFloor: (
      store,
      input: { participantId: string; grantedAtMs: number },
    ) => {
      store.resources.floorParticipantId = input.participantId;
      store.resources.floorGrantedAtMs = input.grantedAtMs;
    },
    clearFloor: (store) => {
      store.resources.floorParticipantId = null;
      store.resources.floorGrantedAtMs = null;
    },
  },
});

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
