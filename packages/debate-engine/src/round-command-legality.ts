import {
  debateSides,
  segmentDueAtMs,
  type DebateSide,
  type RoundCommand,
  type RoundParticipantSeat,
  type RoundRules,
  type SegmentType,
} from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';
import {
  closedCount,
  debateHasEnded,
  type ClockSegment,
  type ClockState,
} from './round-clock-state';

/** Everything that decides whether one seat's command is legal at one instant. */
export type RoundCommandFacts = {
  readonly rules: RoundRules;
  /** The clock already advanced to `nowMs`. */
  readonly state: ClockState;
  readonly participants: readonly RoundParticipantSeat[];
  readonly seat: RoundParticipantSeat | null;
  readonly nowMs: number;
};

/** Why a command is illegal, as data; `applyRoundCommand` raises it. */
export type RoundCommandRefusal =
  | {
      readonly kind: 'invariant';
      readonly id: string;
      readonly message: string;
    }
  | { readonly kind: 'conflict'; readonly message: string };

/** A command this seat could press now, and whether the engine would accept it. */
export type RoundCommandOption = {
  readonly type: RoundCommand['type'];
  readonly legal: boolean;
};

const violates = (id: string, message: string): RoundCommandRefusal => ({
  kind: 'invariant',
  id,
  message,
});
const conflict = (message: string): RoundCommandRefusal => ({
  kind: 'conflict',
  message,
});

const openRowOf = (state: ClockState): ClockSegment | undefined =>
  state.rows.find((row) => row.endedAtMs === null);

/** The side a seat debates for; null for a judge or nobody. */
export const debateSideOf = (
  seat: RoundParticipantSeat | null,
): DebateSide | null =>
  seat !== null && (debateSides as readonly string[]).includes(seat.role)
    ? (seat.role as DebateSide)
    : null;

/**
 * Who holds the floor: whoever an accepted interruption gave it to, else the
 * open segment's scheduled seat. Null when nothing is open.
 */
const floorHolderOf = ({
  rules,
  state,
  participants,
}: Pick<
  RoundCommandFacts,
  'rules' | 'state' | 'participants'
>): RoundParticipantSeat | null => {
  const open = openRowOf(state);
  if (open === undefined) return null;
  const floor = state.checkpoint.floor;
  if (floor !== null)
    return (
      participants.find((seat) => seat.id === floor.holder_participant_id) ??
      null
    );
  const scheduled = rules.segments[open.sequence]!;
  return (
    participants.find(
      (seat) => seat.role === scheduled.side && seat.slot === scheduled.slot,
    ) ?? null
  );
};

/**
 * The segment a seat may spend prep before must exist, be that seat's own, sit
 * inside the spendable window and not have passed the budget's expiry segment.
 */
const prepWindowRefusal = (
  { rules, state }: RoundCommandFacts,
  inRoundPrep: NonNullable<RoundRules['inRoundPrep']>,
  seat: RoundParticipantSeat,
): RoundCommandRefusal | null => {
  const id = debateInvariantIds.prepRequiresSpendableSegment;
  const sequence = closedCount(state);
  const upcoming = rules.segments[sequence];
  if (!upcoming) return violates(id, 'No segment remains to prep for');
  if (upcoming.side !== seat.role || upcoming.slot !== seat.slot)
    return violates(id, 'Prep runs before the prepping seat’s own segment');
  const type: SegmentType = upcoming.type;
  if (!inRoundPrep.spendableBefore.includes(type))
    return violates(id, `Prep is not spendable before a ${type} segment`);
  const expiresAt = inRoundPrep.expiresAtSegment;
  if (
    expiresAt !== null &&
    rules.segments.findIndex((segment) => segment.key === expiresAt) <= sequence
  )
    return violates(id, `Prep expired at segment ${expiresAt}`);
  return null;
};

const startPrepRefusal = (facts: RoundCommandFacts) => {
  const { rules, state, seat } = facts;
  if (state.lifecycle.status !== 'active')
    return conflict('Only an active round spends prep');
  if (openRowOf(state) !== undefined)
    return conflict('A segment is already live');
  if (state.checkpoint.active_prep !== null)
    return conflict('Prep is already running');
  const { inRoundPrep } = rules;
  if (inRoundPrep === null)
    return violates(
      debateInvariantIds.prepRequiresCapability,
      'The resolved rules have no in-round prep',
    );
  const side = debateSideOf(seat);
  if (seat === null || side === null)
    return conflict('Prep belongs to a seated debater');
  const window = prepWindowRefusal(facts, inRoundPrep, seat);
  if (window !== null) return window;
  return state.checkpoint.prep_consumed_ms[side] >= inRoundPrep.budgetMsPerSide
    ? violates(
        debateInvariantIds.prepRequiresBudget,
        'The side’s prep budget is spent',
      )
    : null;
};

const startSpeechRefusal = ({ rules, state, seat }: RoundCommandFacts) => {
  const active = state.checkpoint.active_prep;
  if (active === null)
    return violates(
      debateInvariantIds.startSpeechRequiresPrep,
      'A speech opens out of the prepping side’s prep',
    );
  const upcoming = rules.segments[closedCount(state)];
  return seat?.role === active.side && seat.slot === upcoming?.slot
    ? null
    : conflict('Only the prepping seat ends its own prep');
};

const yieldRefusal = (facts: RoundCommandFacts) => {
  const id = debateInvariantIds.yieldRequiresFloor;
  if (openRowOf(facts.state) === undefined)
    return violates(id, 'Yielding requires a live segment');
  const holder = floorHolderOf(facts);
  if (facts.seat === null || holder === null || facts.seat.id !== holder.id)
    return violates(id, 'Only the floor holder ends their own control');
  return facts.rules.interaction.yield?.allowed === true
    ? null
    : violates(id, 'The resolved rules forbid yielding');
};

/**
 * The floor moves only under an enabled policy. Open questioning grants
 * everyone speech and never transfers the floor, so it has nothing to take.
 */
const interruptRefusal = (facts: RoundCommandFacts) => {
  const id = debateInvariantIds.interruptRequiresPolicy;
  const open = openRowOf(facts.state);
  const policy = facts.rules.interaction.interruptions;
  if (open === undefined || policy.allowed !== 'enabled')
    return violates(id, 'The resolved rules forbid interruptions here');
  if (open.type === 'cross_ex')
    return violates(
      id,
      'Nobody interrupts cross-examination: every debater already speaks',
    );
  const remaining = segmentDueAtMs(open) - facts.nowMs;
  if (remaining < policy.minRemainingMs)
    return violates(id, 'Too little of the segment remains to interrupt');
  if (debateSideOf(facts.seat) === null)
    return conflict('Only a seated debater interrupts');
  return floorHolderOf(facts)?.id === facts.seat?.id
    ? violates(id, 'The floor holder cannot interrupt themselves')
    : null;
};

/**
 * Once the debate is over the Round waits for its ballot, so leaving has
 * nothing left to forfeit and must not pre-empt the judges (ADR 0070).
 */
const forfeitRefusal = ({ rules, state, seat }: RoundCommandFacts) => {
  if (debateHasEnded(state, rules.segments.length))
    return conflict('The debate is over; there is nothing to forfeit');
  return debateSideOf(seat) === null
    ? conflict('A seated debater forfeits')
    : null;
};

const refusals: Readonly<
  Record<
    RoundCommand['type'],
    (facts: RoundCommandFacts) => RoundCommandRefusal | null
  >
> = {
  start_prep: startPrepRefusal,
  start_speech: startSpeechRefusal,
  yield: yieldRefusal,
  interrupt: interruptRefusal,
  forfeit: forfeitRefusal,
};

/** Why this seat may not run this command now, or null when it may. */
export const roundCommandRefusal = (
  facts: RoundCommandFacts,
  type: RoundCommand['type'],
): RoundCommandRefusal | null => {
  const { status } = facts.state.lifecycle;
  if (status === 'completed')
    return violates(
      debateInvariantIds.completedIsTerminal,
      'Completed rounds are terminal',
    );
  if (status === 'abandoned')
    return conflict('An abandoned round takes no commands');
  return refusals[type](facts);
};

/**
 * The commands this seat is offered now. An offered command can be illegal for
 * the moment (an Interrupt inside the protected end); one that is not offered
 * has no meaning for this seat here.
 */
export const roundCommandOptions = (
  facts: RoundCommandFacts,
): readonly RoundCommandOption[] => {
  const side = debateSideOf(facts.seat);
  const forfeit = roundCommandRefusal(facts, 'forfeit') === null;
  if (side === null || !forfeit) return [];
  const option = (type: RoundCommand['type']): RoundCommandOption => ({
    type,
    legal: roundCommandRefusal(facts, type) === null,
  });
  const leave = { type: 'forfeit', legal: true } as const;
  const speech = option('start_speech');
  if (speech.legal) return [speech, leave];
  const open = openRowOf(facts.state);
  if (open === undefined) {
    const prep = option('start_prep');
    return prep.legal ? [prep, leave] : [leave];
  }
  const holds = floorHolderOf(facts)?.id === facts.seat?.id;
  const interrupts =
    facts.rules.interaction.interruptions.allowed === 'enabled' &&
    open.type !== 'cross_ex';
  return [
    ...(holds ? [option('yield')] : []),
    ...(interrupts ? [option('interrupt')] : []),
    leave,
  ];
};
