import { instantMs } from '@daisy/clock/instant';
import { Database } from '@adobe/data/ecs';
import { Schema } from '@adobe/data/schema';
import { segmentTypes, type SegmentType } from '@daisy/protocol/format';
import { type RuntimeCheckpoint } from '@daisy/protocol/round';
import { type SideKey } from '@daisy/protocol/seats';

/**
 * The Adobe ECS plugin the round store runs on (ADR 0058 §6): segment rows
 * as entities, the lifecycle and checkpoint as resources. Vendor types
 * never leave this file.
 */

import type { Lifecycle } from './round-clock-state';

// Each resource takes its type from its default. A function's return type
// is not narrowed to the literal, so these state the whole type.
const opening = (): Lifecycle => ({ status: 'opening' });
const noIncident = (): RuntimeCheckpoint['incident'] => ({ phase: 'none' });
const noPrepConsumed = (): RuntimeCheckpoint['prep_consumed_ms'] => ({});

const plugin = Database.Plugin.create({
  components: {
    sequence: { type: 'number' },
    segmentType: { enum: segmentTypes },
    segmentKey: { type: 'string' },
    startedAtMs: { type: 'number' },
    endedAtMs: Schema.Nullable({ type: 'number' }),
    durationMs: { type: 'number' },
    returnedMs: { type: 'number' },
  },
  resources: {
    lifecycle: { default: opening() },
    incident: { default: noIncident() },
    prepEndedAt: { default: null as RuntimeCheckpoint['prep_ended_at'] },
    startGate: { default: null as RuntimeCheckpoint['start_gate'] },
    clockStops: { default: [] as RuntimeCheckpoint['clock_stops'] },
    /** Prep each side has spent, by side key: one keyed resource (TAB-6.2). */
    prepConsumedMs: { default: noPrepConsumed() },
    activePrepSide: {
      ...Schema.Nullable({ type: 'string' }),
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
    /** The seats that left a Round no forfeit ends, in the order they left. */
    absentParticipantIds: { default: [] as readonly string[] },
  },
  archetypes: {
    segment: [
      'sequence',
      'segmentType',
      'segmentKey',
      'startedAtMs',
      'endedAtMs',
      'durationMs',
      'returnedMs',
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
        returnedMs: number;
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
        returnedMs: row.returnedMs,
      });
    },
    closeSegment: (store, input: { sequence: number; endedAtMs: number }) => {
      const entity = store
        .select(['sequence'])
        .find((e) => store.get(e, 'sequence') === input.sequence);
      if (entity !== undefined)
        store.update(entity, { endedAtMs: input.endedAtMs });
    },
    returnSegment: (store, input: { sequence: number; returnedMs: number }) => {
      const entity = store
        .select(['sequence'])
        .find((e) => store.get(e, 'sequence') === input.sequence);
      if (entity !== undefined)
        store.update(entity, { returnedMs: input.returnedMs });
    },
    setIncident: (
      store,
      input: Pick<RuntimeCheckpoint, 'incident' | 'clock_stops'>,
    ) => {
      store.resources.incident = input.incident;
      store.resources.clockStops = input.clock_stops;
    },
    setPrepEndedAt: (store, at: RuntimeCheckpoint['prep_ended_at']) => {
      store.resources.prepEndedAt = at;
    },
    setStartGate: (store, gate: RuntimeCheckpoint['start_gate']) => {
      store.resources.startGate = gate;
    },
    setLifecycle: (store, lifecycle: Lifecycle) => {
      store.resources.lifecycle = lifecycle;
    },
    setCheckpoint: (store, checkpoint: RuntimeCheckpoint) => {
      store.resources.prepEndedAt = checkpoint.prep_ended_at;
      store.resources.startGate = checkpoint.start_gate;
      store.resources.incident = checkpoint.incident;
      store.resources.clockStops = checkpoint.clock_stops;
      store.resources.prepConsumedMs = { ...checkpoint.prep_consumed_ms };
      store.resources.activePrepSide = checkpoint.active_prep?.side ?? null;
      store.resources.activePrepStartedAtMs =
        checkpoint.active_prep === null
          ? null
          : instantMs(checkpoint.active_prep.started_at);
      store.resources.floorParticipantId =
        checkpoint.floor?.holder_participant_id ?? null;
      store.resources.floorGrantedAtMs =
        checkpoint.floor === null
          ? null
          : instantMs(checkpoint.floor.granted_at);
      store.resources.absentParticipantIds =
        checkpoint.absent_participant_ids ?? [];
    },
    markAbsent: (store, participantId: string) => {
      store.resources.absentParticipantIds = [
        ...store.resources.absentParticipantIds,
        participantId,
      ];
    },
    setPrepConsumed: (
      store,
      consumed: RuntimeCheckpoint['prep_consumed_ms'],
    ) => {
      store.resources.prepConsumedMs = { ...consumed };
    },
    startPrep: (store, input: { side: SideKey; startedAtMs: number }) => {
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
