import {
  leadSeatOf,
  otherSide,
  roundStartPolicy,
  sideOfSeat,
  sideSeat,
  type SideKey,
  type RoundCommand,
  type RoundPosition,
  type RoundRules,
} from '@daisy/protocol';
import { seatAt, type CorpusSeat } from './corpus-seats';
import type { Durable } from './durable';

/** What the script does at one instant. */
export type ScriptAction =
  | { readonly kind: 'activate' }
  | { readonly kind: 'tick' }
  | {
      readonly kind: 'command';
      readonly type: RoundCommand['type'];
      readonly seatId: string;
    }
  | { readonly kind: 'complete_panel'; readonly winner: SideKey };

/** The paths a script exercises, each once, where the rules allow them. */
type Exercised =
  'refusal' | 'prep' | 'yield' | 'interrupt' | 'floor_return' | 'panel';

export type ScriptState = {
  readonly rules: RoundRules;
  readonly seats: readonly CorpusSeat[];
  readonly interrupting: boolean;
  readonly nowMs: number;
  readonly done: ReadonlySet<Exercised>;
  readonly durable: Durable;
};

export type Planned = {
  readonly atMs: number;
  readonly action: ScriptAction;
  readonly exercises?: Exercised;
};

type OpenSegment = NonNullable<RoundPosition['openSegment']>;
type Move = (state: ScriptState, open: OpenSegment) => Planned | null;

/** The seat a segment is scheduled to: the speaker, or the asker. */
const leadOf = (state: ScriptState, sequence: number) =>
  leadSeatOf(state.rules.segments[sequence]!.speak)!;
const speakerOf = (state: ScriptState, sequence: number) =>
  seatAt(state.seats, leadOf(state, sequence));
const opponentOf = (state: ScriptState, sequence: number) =>
  seatAt(
    state.seats,
    sideSeat(
      otherSide(state.rules.sides, sideOfSeat(leadOf(state, sequence))!),
    ),
  );
const command = (
  type: RoundCommand['type'],
  seat: CorpusSeat,
): ScriptAction => ({ kind: 'command', type, seatId: seat.id });
const tickAt = (atMs: number): Planned => ({ atMs, action: { kind: 'tick' } });
const isSpeech = (state: ScriptState, open: OpenSegment) =>
  state.rules.segments[open.sequence]!.type === 'speech';

/** The speech-segment ordinal of `sequence`: 0 for the first speech, and so on. */
const speechOrdinal = (rules: RoundRules, sequence: number) =>
  rules.segments.slice(0, sequence).filter((s) => s.type === 'speech').length;

/** The first segment at or after the third that prep may be spent before. */
const prepTarget = (rules: RoundRules): number | null => {
  const prep = rules.inRoundPrep;
  if (!prep || prep.budgetMsPerSide === 0) return null;
  const index = rules.segments.findIndex(
    (segment, sequence) =>
      sequence >= 2 && prep.spendableBefore.includes(segment.type),
  );
  return index === -1 ? null : index;
};

/** The opponent yielding a floor it does not hold: the refusal path. */
const refusedYield: Move = (state, open) =>
  state.done.has('refusal')
    ? null
    : {
        atMs: state.nowMs + 1_000,
        action: command('yield', opponentOf(state, open.sequence)),
        exercises: 'refusal',
      };

/** An interrupter handing the floor back to the speaker. */
const floorReturn: Move = (state, open) => {
  const holder = state.seats.find((s) => s.id === open.floorParticipantId);
  return !holder || state.done.has('floor_return')
    ? null
    : {
        atMs: state.nowMs + 5_000,
        action: command('yield', holder),
        exercises: 'floor_return',
      };
};

/** The opponent interrupting the first speech the enabled policy allows. */
const interruption: Move = (state, open) => {
  const policy = state.rules.interaction.interruptions;
  return state.interrupting &&
    !state.done.has('interrupt') &&
    isSpeech(state, open) &&
    policy.allowed === 'enabled' &&
    open.remainingMs > policy.minRemainingMs + 20_000
    ? {
        atMs: state.nowMs + 10_000,
        action: command('interrupt', opponentOf(state, open.sequence)),
        exercises: 'interrupt',
      }
    : null;
};

/** The speaker yielding the second speech halfway through. */
const earlyYield: Move = (state, open) =>
  state.rules.interaction.yield?.allowed === true &&
  !state.done.has('yield') &&
  isSpeech(state, open) &&
  speechOrdinal(state.rules, open.sequence) === 1
    ? {
        atMs: state.nowMs + Math.floor(open.remainingMs / 2),
        action: command('yield', speakerOf(state, open.sequence)),
        exercises: 'yield',
      }
    : null;

const moves: readonly Move[] = [
  refusedYield,
  floorReturn,
  interruption,
  earlyYield,
];

/** During an open segment: the first move that applies, else run to its end. */
const duringSegment = (state: ScriptState, open: OpenSegment): Planned => {
  for (const move of moves) {
    const planned = move(state, open);
    if (planned) return planned;
  }
  return tickAt(Date.parse(open.endsAt));
};

/** Before a segment: start prep where the rules allow, else reach the microphone lead, then the clock. */
const beforeSegment = (
  state: ScriptState,
  next: NonNullable<RoundPosition['nextSegment']>,
  leftMs: number,
  budget: RoundPosition['prepBudgetRemainingMs'],
): Planned => {
  const lead = roundStartPolicy.microphoneLeadMs;
  if (
    !state.done.has('prep') &&
    next.sequence === prepTarget(state.rules) &&
    (budget?.[sideOfSeat(next.lead!)!] ?? 0) > 0 &&
    leftMs > 2_000
  )
    return {
      atMs: state.nowMs + 2_000,
      action: command('start_prep', speakerOf(state, next.sequence)),
      exercises: 'prep',
    };
  return tickAt(state.nowMs + (leftMs > lead ? leftMs - lead : leftMs));
};

/** After the schedule: every judge rules, once, a minute after the final end. */
const afterDebate = (state: ScriptState): Planned | null =>
  state.done.has('panel')
    ? null
    : {
        atMs:
          Math.max(
            state.nowMs,
            Date.parse(state.durable.finalSegmentEndedAt ?? ''),
          ) + 60_000,
        action: { kind: 'complete_panel', winner: 'affirmative' },
        exercises: 'panel',
      };

/** During prep: the next speaker ends it after thirty seconds, or half what is left. */
const duringPrep = (
  state: ScriptState,
  prep: NonNullable<RoundPosition['prep']>,
  nextSequence: number,
): Planned => ({
  atMs: state.nowMs + Math.min(30_000, Math.floor(prep.remainingMs / 2)),
  action: command('start_speech', speakerOf(state, nextSequence)),
});

/** While the Round runs: the step its stage calls for. */
const whileActive = (state: ScriptState, position: RoundPosition): Planned => {
  const { prep, openSegment, nextSegment, countdownRemainingMs } = position;
  if (prep && nextSegment) return duringPrep(state, prep, nextSegment.sequence);
  if (openSegment) return duringSegment(state, openSegment);
  if (nextSegment && countdownRemainingMs !== null)
    return beforeSegment(
      state,
      nextSegment,
      countdownRemainingMs,
      position.prepBudgetRemainingMs,
    );
  return tickAt(state.nowMs + 1_000);
};

/** The script's next step, or null once the Round has ended. */
export const plan = (
  state: ScriptState,
  position: RoundPosition,
): Planned | null => {
  if (position.status === 'opening')
    return { atMs: state.nowMs, action: { kind: 'activate' } };
  if (position.status !== 'active') return null;
  return position.stage === 'awaiting_ballot'
    ? afterDebate(state)
    : whileActive(state, position);
};
