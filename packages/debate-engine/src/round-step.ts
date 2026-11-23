import { leadSeatOf } from '@daisy/protocol/format-seating';
import type { RoundRules } from '@daisy/protocol/format';
import type {
  RoundEffect,
  RoundParticipantSeat,
} from '@daisy/protocol/runtime';
import type { RuntimeCheckpoint } from '@daisy/protocol/round';
import type { ClockChange, ClockTransition } from './round-clock-transition';
import type { ClockState, Lifecycle } from './round-clock-state';

/**
 * A Round's whole state as one value: its clock (lifecycle, checkpoint and
 * segment rows) and the seats it was cast with. Nothing else decides what
 * happens to it next.
 */
export type RoundState = {
  readonly clock: ClockState;
  readonly cast: readonly RoundParticipantSeat[];
};

/** The floor moved inside one segment; a null holder hands it back to the scheduled seat. */
export type FloorChange = {
  readonly sequence: number;
  readonly at: string;
  readonly holder: string | null;
};

/**
 * What one event did to a Round, as data: the next state and everything it
 * caused. Ids are not here; the projection mints them.
 */
export type RoundStep = {
  readonly state: RoundState;
  readonly changes: readonly ClockChange[];
  readonly effects: readonly RoundEffect[];
  /** The actors whose seats left in this step; the Room holds them no longer. */
  readonly releasedMembers: readonly string[];
  readonly floorChange: FloorChange | null;
  /** The played end a terminal step settled on, when the clock's own close does not say it. */
  readonly finalPlayedEnd: string | null;
};

/** A step that has done nothing yet. */
export const stepFrom = (state: RoundState): RoundStep => ({
  state,
  changes: [],
  effects: [],
  releasedMembers: [],
  floorChange: null,
  finalPlayedEnd: null,
});

export const clockOf = (step: RoundStep): ClockState => step.state.clock;

const withClock = (step: RoundStep, clock: ClockState): RoundStep => ({
  ...step,
  state: { ...step.state, clock },
});

export const withLifecycle = (
  step: RoundStep,
  lifecycle: Lifecycle,
): RoundStep => withClock(step, { ...clockOf(step), lifecycle });

export const withCheckpoint = (
  step: RoundStep,
  patch: Partial<RuntimeCheckpoint>,
): RoundStep =>
  withClock(step, {
    ...clockOf(step),
    checkpoint: { ...clockOf(step).checkpoint, ...patch },
  });

export const emit = (step: RoundStep, effect: RoundEffect): RoundStep => ({
  ...step,
  effects: [...step.effects, effect],
});

export const record = (
  step: RoundStep,
  ...changes: readonly ClockChange[]
): RoundStep => ({ ...step, changes: [...step.changes, ...changes] });

export const release = (step: RoundStep, actorId: string): RoundStep => ({
  ...step,
  releasedMembers: [...step.releasedMembers, actorId],
});

export const moveFloor = (step: RoundStep, floor: FloorChange): RoundStep => ({
  ...step,
  floorChange: floor,
});

export const settleFinalEnd = (step: RoundStep, at: string): RoundStep => ({
  ...step,
  finalPlayedEnd: at,
});

const iso = (ms: number) => new Date(ms).toISOString();

/** The effects a clock change announces: each segment's opening and closing. */
const segmentEffectsOf = (
  rules: RoundRules,
  changes: readonly ClockChange[],
): RoundEffect[] =>
  changes.flatMap((change): RoundEffect[] => {
    if (change.kind === 'close')
      return [
        { kind: 'segment_closed', key: change.key, at: iso(change.atMs) },
      ];
    if (change.kind !== 'open') return [];
    const expected = rules.segments[change.row.sequence]!;
    return [
      {
        kind: 'segment_opened',
        key: expected.key,
        lead: leadSeatOf(expected.speak),
        type: expected.type,
        at: iso(change.row.startedAtMs),
      },
    ];
  });

/** A clock transition taken into the step: its state, its changes and the effects they announce. */
export const take = (
  step: RoundStep,
  rules: RoundRules,
  transition: ClockTransition,
): RoundStep => ({
  ...withClock(step, transition.state),
  changes: [...step.changes, ...transition.changes],
  effects: [...step.effects, ...segmentEffectsOf(rules, transition.changes)],
});
