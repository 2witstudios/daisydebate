import { daisyBallotSource } from '@daisy/protocol/ballot-definition';
import { mediaGrants } from '@daisy/debate-engine';
import { roundControlsAt } from '@daisy/debate-engine/position';
import { daisyWinnerBallot } from '@daisy/protocol/ballot-definition';
import { isJudgeSeat, type SideKey } from '@daisy/protocol/seats';
import {
  type RoundPosition,
  type RoundProjection,
} from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import { type RuntimeCheckpoint } from '@daisy/protocol/round';
import { attempt, type Recorded } from './refusal';
import { hydrate, opening, persisted } from './durable';
import { corpusStartMs, seatsOf } from './corpus-seats';
import { plan, type ScriptAction, type ScriptState } from './round-plan';

type RoundRuntime = ReturnType<typeof hydrate>;
const iso = (ms: number) => new Date(ms).toISOString();

/** Every judge seat rules for `winner`, inside a human window that has closed. */
const panelCompletion = (state: ScriptState, winner: SideKey, now: string) => {
  const judges = state.seats.filter((s) => isJudgeSeat(s.seat));
  const [first, ...rest] = judges.map((s) => s.id);
  return {
    now,
    judging: {
      source: daisyBallotSource(daisyWinnerBallot),
      ballot: daisyWinnerBallot,
      panel: { decision: 'majority' as const, quorum: 1 },
    },
    completeness: 'complete' as const,
    ballots: judges.map((s) => ({ judgeParticipantId: s.id, winner })),
    panel: {
      humanWindow:
        first === undefined
          ? null
          : { deadlineAt: now, seatIds: [first, ...rest] as const },
      aiSeats: [],
    },
  };
};

const run = (
  runtime: RoundRuntime,
  state: ScriptState,
  action: ScriptAction,
  now: string,
): RoundProjection => {
  switch (action.kind) {
    case 'activate':
      return runtime.activate({ at: now, now });
    case 'tick':
      return runtime.tick(now);
    case 'command': {
      const seat = state.seats.find((s) => s.id === action.seatId);
      if (!seat) throw new Error(`No seat ${action.seatId} in the script`);
      return runtime.execute({
        command: action.command,
        actorId: seat.actorId,
        now,
      });
    }
    case 'complete_panel':
      return runtime.completePanel(panelCompletion(state, action.winner, now));
  }
};

/** Each seat's media grants at `now`, by seat id. */
const grantsAt = (state: ScriptState, position: RoundPosition, now: string) =>
  Object.fromEntries(
    state.seats.map((seat) => [
      seat.id,
      mediaGrants({
        participants: state.seats,
        participantId: seat.id,
        rules: state.rules,
        position,
        now,
        finalSegmentEndedAt: state.durable.finalSegmentEndedAt,
        inPreRoundPrep: false,
      }),
    ]),
  );

/** The commands each debating seat is offered at `now`, read from the persisted rows alone. */
const optionsAt = (state: ScriptState, nowMs: number) =>
  Object.fromEntries(
    state.seats
      .filter((seat) => !isJudgeSeat(seat.seat))
      .map((seat) => [
        seat.id,
        roundControlsAt({
          round: state.durable.round,
          segments: state.durable.segments,
          checkpoint: state.durable.checkpoint,
          rules: state.rules,
          participants: state.seats,
          seat,
          nowMs,
        }).options,
      ]),
  );

/** One recorded step: what was done, what the runtime projected, and what every seat then saw. */
export type ScriptStep = {
  readonly step: number;
  readonly now: string;
  readonly action: ScriptAction;
  readonly result: Recorded<RoundProjection>;
  readonly position: RoundPosition;
  readonly debateOver: boolean;
  /** Present only when they changed since the previous step. */
  readonly grants?: ReturnType<typeof grantsAt> | undefined;
  readonly options?: ReturnType<typeof optionsAt> | undefined;
  readonly checkpoint?: RuntimeCheckpoint | undefined;
};

const MAX_STEPS = 400;

/** Present when `value` differs from the last recorded one. */
const ifChanged = <T>(value: T, last: { json: string }): T | undefined => {
  const json = JSON.stringify(value);
  if (json === last.json) return undefined;
  last.json = json;
  return value;
};

/**
 * Drives a fresh Round over `rules` from activation to a completed panel,
 * through every segment boundary (each countdown's microphone lead, each
 * opening and close) and, where the rules allow, a refused yield, prep, a
 * yield, and a point of information offered, accepted and given back.
 */
export function scriptRound(input: {
  readonly rules: RoundRules;
  /** Whether the script offers and takes a point of information where the rules allow. */
  readonly offering: boolean;
}): readonly ScriptStep[] {
  const seats = seatsOf(input.rules);
  const runtime = hydrate(input.rules, seats, opening);
  let state: ScriptState = {
    ...input,
    seats,
    nowMs: corpusStartMs,
    done: new Set(),
    durable: opening,
  };
  const last = {
    grants: { json: '' },
    options: { json: '' },
    checkpoint: { json: '' },
  };
  const steps: ScriptStep[] = [];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const planned = plan(state, runtime.position(iso(state.nowMs)));
    if (!planned) return steps;
    const now = iso(planned.atMs);
    const result = attempt(() => run(runtime, state, planned.action, now));
    state = {
      ...state,
      nowMs: planned.atMs,
      done: planned.exercises
        ? new Set([...state.done, planned.exercises])
        : state.done,
      durable: result.ok
        ? persisted(state.durable, result.value)
        : state.durable,
    };
    const position = runtime.position(now);
    steps.push({
      step,
      now,
      action: planned.action,
      result,
      position,
      debateOver: runtime.debateOverAt(now),
      grants: ifChanged(grantsAt(state, position, now), last.grants),
      options: ifChanged(optionsAt(state, planned.atMs), last.options),
      checkpoint: ifChanged(runtime.checkpoint(), last.checkpoint),
    });
  }
  throw new Error(`The script did not end the Round in ${MAX_STEPS} steps`);
}
