import { Database } from '@adobe/data/ecs';
import { Schema } from '@adobe/data/schema';
import {
  debateSides,
  roundStatuses,
  segmentTypes,
  type DebateSide,
  type RuntimeCheckpoint,
  type SegmentType,
} from '@daisy/protocol';

/**
 * The Adobe ECS plugin the round store runs on (ADR 0058 §6): segment rows
 * as entities, the lifecycle and checkpoint as resources. Vendor types
 * never leave this file.
 */

import type { Lifecycle } from './round-clock-state';

const plugin = Database.Plugin.create({
  components: {
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
        sequence: number;
        type: SegmentType;
        key: string;
        startedAtMs: number;
        durationMs: number;
        endedAtMs?: number | null;
      },
    ) => {
      store.archetypes.segment.insert({
        sequence: row.sequence,
        segmentType: row.type,
        segmentKey: row.key,
        startedAtMs: row.startedAtMs,
        endedAtMs: row.endedAtMs ?? null,
        durationMs: row.durationMs,
      });
    },
    closeSegment: (store, input: { sequence: number; endedAtMs: number }) => {
      const entity = store
        .select(['sequence'])
        .find((e) => store.get(e, 'sequence') === input.sequence);
      if (entity !== undefined)
        store.update(entity, { endedAtMs: input.endedAtMs });
    },
    setLifecycle: (store, lifecycle: Lifecycle) => {
      store.resources.status = lifecycle.status;
      store.resources.startedAtMs = lifecycle.startedAtMs;
      store.resources.completedAtMs = lifecycle.completedAtMs;
      store.resources.outcome = lifecycle.outcome;
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
