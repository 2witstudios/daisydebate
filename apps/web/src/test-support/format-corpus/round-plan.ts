import { instantMs } from '@daisy/clock';
import { leadSeatOf } from '@daisy/protocol/format-seating';
import {
  otherSide,
  sideOfSeat,
  sideSeat,
  type SideKey,
  type SeatRef,
} from '@daisy/protocol/seats';
import { roundStartPolicy } from '@daisy/protocol/round-start-policy';
import { type RoundCommand, type RoundPosition } from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import { seatAt, type CorpusSeat } from './corpus-seats';
import type { Durable } from './durable';

/** What the script does at one instant. */
export type ScriptAction =
  | { readonly kind: 'activate' }
  | { readonly kind: 'tick' }
  | {
      readonly kind: 'command';
      /** The command exactly as pressed, with the segment it names. */
      readonly command: RoundCommand;
      readonly seatId: string;
    }
  | { readonly kind: 'complete_panel'; readonly winner: SideKey };

/** The paths a script exercises, each once, where the rules allow them. */
type Exercised =
  'refusal' | 'prep' | 'yield' | 'poi_offer' | 'poi_accept' | 'panel';

export type ScriptState = {
  readonly rules: RoundRules;
  readonly seats: readonly CorpusSeat[];
  readonly offering: boolean;
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
type Move = (
  state: ScriptState,
  open: OpenSegment,
  position: RoundPosition,
) => Planned | null;

/** The seat a segment is scheduled to: the speaker, or the asker. */
const leadOf = (state: ScriptState, sequence: number): SeatRef => {
  const lead = leadSeatOf(state.rules.segments[sequence]!.speak);
  if (!lead) throw new Error(`Segment ${sequence} has no lead seat`);
  return lead;
};
const speakerOf = (state: ScriptState, sequence: number) =>
  seatAt(state.seats, leadOf(state, sequence));
/** The lead's opponent: a script only offers to or refuses a side's segment. */
const opponentOf = (state: ScriptState, sequence: number) => {
  const lead = leadOf(state, sequence);
  const side = sideOfSeat(lead);
  if (!side) throw new Error(`Segment ${sequence} is led by a ${lead.kind}`);
  return seatAt(state.seats, sideSeat(otherSide(state.rules.sides, side)));
};
/** The prep the lead's side has left; a seat on no side has none. */
const prepLeftOf = (
  lead: SeatRef | null,
  budget: RoundPosition['prepBudgetRemainingMs'],
): number => {
  if (!lead) throw new Error('The prep target segment has no lead seat');
  const side = sideOfSeat(lead);
  return side === null ? 0 : (budget?.[side] ?? 0);
};
const command = (command: RoundCommand, seat: CorpusSeat): ScriptAction => ({
  kind: 'command',
  command,
  seatId: seat.id,
});
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
        action: command(
          { type: 'yield', sequence: open.sequence },
          opponentOf(state, open.sequence),
        ),
        exercises: 'refusal',
      };

/** The opponent offering a point of information in the first speech that takes one. */
const offer: Move = (state, open, position) => {
  const window = position.pointOfInformation;
  const atMs = window ? instantMs(window.offersOpenAt) + 5_000 : 0;
  return state.offering &&
    !state.done.has('poi_offer') &&
    window !== null &&
    atMs + 20_000 < instantMs(window.offersCloseAt)
    ? {
        atMs: Math.max(state.nowMs, atMs),
        action: command(
          { type: 'offer_poi', sequence: open.sequence },
          opponentOf(state, open.sequence),
        ),
        exercises: 'poi_offer',
      }
    : null;
};

/** The speaker taking the standing offer; its point gives the speech back by itself. */
const accept: Move = (state, open, position) => {
  const standing = position.pointOfInformation?.offers[0];
  return standing === undefined || state.done.has('poi_accept')
    ? null
    : {
        atMs: state.nowMs + 2_000,
        action: command(
          {
            type: 'accept_poi',
            sequence: open.sequence,
            offererParticipantId: standing.participantId,
          },
          speakerOf(state, open.sequence),
        ),
        exercises: 'poi_accept',
      };
};

/** The speaker yielding the second speech halfway through. */
const earlyYield: Move = (state, open) =>
  state.rules.interaction.yield?.allowed === true &&
  !state.done.has('yield') &&
  isSpeech(state, open) &&
  speechOrdinal(state.rules, open.sequence) === 1
    ? {
        atMs: state.nowMs + Math.floor(open.remainingMs / 2),
        action: command(
          { type: 'yield', sequence: open.sequence },
          speakerOf(state, open.sequence),
        ),
        exercises: 'yield',
      }
    : null;

const moves: readonly Move[] = [refusedYield, accept, offer, earlyYield];

/** During an open segment: the first move that applies, else run to its end or a point's. */
const duringSegment = (
  state: ScriptState,
  open: OpenSegment,
  position: RoundPosition,
): Planned => {
  for (const move of moves) {
    const planned = move(state, open, position);
    if (planned) return planned;
  }
  const holder = position.pointOfInformation?.holder;
  return tickAt(holder ? instantMs(holder.endsAt) : instantMs(open.endsAt));
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
    prepLeftOf(next.lead, budget) > 0 &&
    leftMs > 2_000
  )
    return {
      atMs: state.nowMs + 2_000,
      action: command(
        { type: 'start_prep', sequence: next.sequence },
        speakerOf(state, next.sequence),
      ),
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
            instantMs(state.durable.finalSegmentEndedAt ?? ''),
          ) + 60_000,
        action: { kind: 'complete_panel', winner: 'affirmative' },
        exercises: 'panel',
      };

/** During prep: the next speaker ends it after thirty seconds, or half what is left. */
const duringPrep = (
  state: ScriptState,
  prep: Extract<NonNullable<RoundPosition['prep']>, { phase: 'running' }>,
  nextSequence: number,
): Planned => ({
  atMs: state.nowMs + Math.min(30_000, Math.floor(prep.remainingMs / 2)),
  action: command(
    { type: 'start_speech', sequence: nextSequence },
    speakerOf(state, nextSequence),
  ),
});

/** While the Round runs: the step its stage calls for. */
const whileActive = (state: ScriptState, position: RoundPosition): Planned => {
  const { prep, openSegment, nextSegment, countdownRemainingMs } = position;
  if (prep?.phase === 'running' && nextSegment)
    return duringPrep(state, prep, nextSegment.sequence);
  if (openSegment) return duringSegment(state, openSegment, position);
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
