import { Database } from '@adobe/data/ecs';
import { Schema } from '@adobe/data/schema';
import {
  debateSides,
  roundStatuses,
  segmentTypes,
  type DebateSide,
  type RatedOutcome,
  type RoundStatus,
  type RuntimeCheckpoint,
  type SegmentType,
} from '@daisy/protocol';

/**
 * The Adobe ECS plugin the round store runs on (ADR 0058 §6): segment rows
 * as entities, the lifecycle and checkpoint as resources. Vendor types
 * never leave this file.
 */

/** The round row's lifecycle columns, in epoch milliseconds. */
export type Lifecycle = {
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

export { plugin };
