import { instantMs } from '@daisy/clock/instant';
import { createInvariantError } from '@daisy/errors';
import { heldSeatsComplete } from '@daisy/protocol/format-seating';
import { clockStopsOf, prepConsumedOf } from '@daisy/protocol/round';
import { otherSide } from '@daisy/protocol/seats';
import { runningMs } from '@daisy/protocol/clock-stops';
import { winnerOutcome } from '@daisy/protocol/round-outcome';
import type {
  RoundCommand,
  RoundParticipantSeat,
} from '@daisy/protocol/runtime';
import type { RoundRules } from '@daisy/protocol/format';
import type { RoundOutcome } from '@daisy/protocol/round-outcome';
import { completedLifecycle, debateHasEnded } from './round-clock-state';
import { closeClockSegment } from './round-clock-transition';
import {
  debateSideOf,
  roundCommandRefusal,
  type RoundCommandRefusal,
} from './round-command-legality';
import { interrupt, yieldFloor } from './round-floor';
import { debateInvariantIds } from './invariant-ids';
import { invariant, refuse } from './round-refusals';
import {
  clockOf,
  emit,
  record,
  release,
  settleFinalEnd,
  take,
  withCheckpoint,
  withLifecycle,
  type RoundStep,
} from './round-step';

/** Who acts, when, under which rules: the facts a step reads besides the Round itself. */
export type StepFacts = {
  readonly rules: RoundRules;
  readonly actorId: string | null;
  readonly now: number;
};

const iso = (ms: number): string => new Date(ms).toISOString();

/** The seat an actor holds in this Round, if any. */
export const seatOf = (
  step: RoundStep,
  actorId: string | null,
): RoundParticipantSeat | null =>
  actorId === null
    ? null
    : (step.state.cast.find((seat) => seat.actorId === actorId) ?? null);

/** Every declared seat is held exactly once, and no other (ADR 0058 §8). */
export const assertSeatCompleteness = (
  step: RoundStep,
  rules: RoundRules,
): void => {
  if (
    !heldSeatsComplete(
      rules,
      step.state.cast.map((participant) => participant.seat),
    )
  )
    throw createInvariantError(
      debateInvariantIds.seatCompleteness,
      'The held seats are not exactly the seats the rules declare',
    );
};

/** Closes one open segment at `at`, through the clock's own primitive. */
export const closeSegmentAt = (
  step: RoundStep,
  rules: RoundRules,
  sequence: number,
  at: number,
): RoundStep =>
  take(step, rules, closeClockSegment(clockOf(step), sequence, at));

/** Only an opening Round starts; the clock anchors here. */
export const startRound = (step: RoundStep, f: StepFacts): RoundStep => {
  if (clockOf(step).lifecycle.status !== 'opening')
    refuse('CONFLICT', 'Only an opening round starts');
  assertSeatCompleteness(step, f.rules);
  return emit(withLifecycle(step, { status: 'active', startedAtMs: f.now }), {
    kind: 'round_started',
    at: iso(f.now),
  });
};

/**
 * Elective in-round prep: only a seated debater, only before their own
 * segment, only while the format's prep bounds and budget allow it.
 */
const startPrep = (step: RoundStep, f: StepFacts): RoundStep => {
  const side = debateSideOf(seatOf(step, f.actorId));
  if (side === null) refuse('CONFLICT', 'Prep belongs to a seated debater');
  // Prep supersedes the rest of the countdown, and closes the microphone the
  // gate waited for: the next start gates afresh.
  return emit(
    withCheckpoint(step, {
      active_prep: { side, started_at: iso(f.now) },
      start_gate: null,
    }),
    { kind: 'prep_started', side, at: iso(f.now) },
  );
};

/**
 * Ending prep folds elapsed into it. The speech opens one microphone lead later, on the
 * clock, so capture has the speaker before their first word and prep stays private.
 */
const startSpeech = (step: RoundStep, f: StepFacts): RoundStep => {
  const { checkpoint } = clockOf(step);
  const active = checkpoint.active_prep;
  if (active === null)
    invariant(
      debateInvariantIds.startSpeechRequiresPrep,
      'A speech opens out of the prepping side’s prep',
    );
  const side = active.side;
  const elapsed = runningMs(
    instantMs(active.started_at),
    f.now,
    clockStopsOf(checkpoint),
  );
  const budget = f.rules.inRoundPrep?.budgetMsPerSide ?? 0;
  return withCheckpoint(step, {
    prep_consumed_ms: {
      ...checkpoint.prep_consumed_ms,
      [side]: Math.min(
        budget,
        prepConsumedOf(checkpoint, side) + Math.max(0, elapsed),
      ),
    },
    active_prep: null,
    prep_ended_at: iso(f.now),
  });
};

/** Whether every segment has closed: the debate is over and only its result is left. */
export const debateIsOver = (step: RoundStep, rules: RoundRules): boolean =>
  debateHasEnded(clockOf(step), rules.segments.length);

/** Close actual played capture authority for either terminal decision. */
export function closePlayedRound(step: RoundStep, f: StepFacts): RoundStep {
  const open = clockOf(step).rows.find((row) => row.endedAtMs === null);
  let closed =
    open === undefined
      ? step
      : closeSegmentAt(step, f.rules, open.sequence, f.now);
  const { incident, clock_stops } = clockOf(closed).checkpoint;
  if (incident.phase !== 'none')
    closed = record(
      withCheckpoint(closed, {
        incident: { phase: 'none' },
        clock_stops: [...clock_stops, { from: incident.since, to: iso(f.now) }],
      }),
      { kind: 'incident', change: { kind: 'ended', at: iso(f.now) } },
    );
  closed = withCheckpoint(closed, { active_prep: null, prep_ended_at: null });
  const lastPlayed = clockOf(closed).rows.at(-1)?.endedAtMs;
  return lastPlayed === undefined || lastPlayed === null
    ? closed
    : settleFinalEnd(closed, iso(lastPlayed));
}

export const completeWith = (
  step: RoundStep,
  f: StepFacts,
  outcome: RoundOutcome | null,
): RoundStep =>
  emit(
    withLifecycle(
      step,
      completedLifecycle(clockOf(step).lifecycle, outcome, f.now),
    ),
    { kind: 'round_completed', outcome, at: iso(f.now) },
  );

/**
 * Forfeiting closes the round with the other side's win; legality admits it
 * only in a two-sided Round decided by a winner. Once the debate
 * is over the Round waits for its ballot, so leaving has nothing left to forfeit
 * and must not pre-empt the judges (ADR 0070). The step advances the clock
 * first, so a segment that ran out with no tick persisted counts as closed.
 */
const forfeit = (step: RoundStep, f: StepFacts): RoundStep => {
  const side = debateSideOf(seatOf(step, f.actorId));
  if (side === null) refuse('CONFLICT', 'A seated debater forfeits');
  // A forfeit in the opening stands as a result, with no resolution before a
  // reveal; the record needs a start, so the Round starts and ends here.
  const started =
    clockOf(step).lifecycle.status === 'opening' ? startRound(step, f) : step;
  return completeWith(
    closePlayedRound(started, f),
    f,
    winnerOutcome(otherSide(f.rules.sides, side)),
  );
};

/**
 * Leaving a Round no forfeit ends (TAB-6.8): the seat is absent from now on
 * and the Room holds its member no longer. Nothing else changes: the clock
 * runs on, and attendance decides each of its speeches on who is present,
 * abandoning the Round only once no speaking seat is.
 */
const leave = (step: RoundStep, f: StepFacts): RoundStep => {
  const seat = seatOf(step, f.actorId);
  if (seat === null) refuse('CONFLICT', 'A seated competitor leaves');
  const absent = clockOf(step).checkpoint.absent_participant_ids ?? [];
  return release(
    withCheckpoint(step, { absent_participant_ids: [...absent, seat.id] }),
    seat.actorId,
  );
};

const raise = (refusal: RoundCommandRefusal): never =>
  refusal.kind === 'conflict'
    ? refuse('CONFLICT', refusal.message)
    : invariant(refusal.id, refusal.message);

/** Applies one legal command, or throws; the Round it was given is never touched. */
export const applyRoundCommand = (
  step: RoundStep,
  f: StepFacts,
  command: RoundCommand,
): RoundStep => {
  const refusal = roundCommandRefusal(
    {
      rules: f.rules,
      state: clockOf(step),
      participants: step.state.cast,
      seat: seatOf(step, f.actorId),
      nowMs: f.now,
    },
    command.type,
  );
  if (refusal !== null) raise(refusal);
  switch (command.type) {
    case 'start_prep':
      return startPrep(step, f);
    case 'start_speech':
      return startSpeech(step, f);
    case 'yield':
      return yieldFloor(step, f);
    case 'interrupt':
      return interrupt(step, f);
    case 'forfeit':
      return forfeit(step, f);
    case 'leave':
      return leave(step, f);
  }
};
