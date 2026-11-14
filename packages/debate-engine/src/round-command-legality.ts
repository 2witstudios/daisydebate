import {
  isDebatingSeat,
  leadSeatOf,
  prepConsumedOf,
  sameSeat,
  segmentDueAtMs,
  sideOfSeat,
  type RoundCommand,
  type RoundParticipantSeat,
  type RoundRules,
  type SegmentType,
  type SideKey,
} from '@daisy/protocol';
import { forfeitsToOpponent } from './round-outcome';
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

/** The side a seat debates for; null for an unsided seat, a judge or nobody. */
export const debateSideOf = (
  seat: RoundParticipantSeat | null,
): SideKey | null => (seat === null ? null : sideOfSeat(seat.seat));

/** Whether a seat is a competitor's: a side's or an unsided speaker's. */
const isDebater = (
  seat: RoundParticipantSeat | null,
): seat is RoundParticipantSeat => seat !== null && isDebatingSeat(seat.seat);

/** Whether this participant holds the segment's scheduled seat. */
const holdsLead = (
  seat: RoundParticipantSeat | null,
  segment: RoundRules['segments'][number] | undefined,
): boolean => {
  const lead = segment === undefined ? null : leadSeatOf(segment.speak);
  return seat !== null && lead !== null && sameSeat(seat.seat, lead);
};

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
  const scheduled = rules.segments[open.sequence];
  return participants.find((seat) => holdsLead(seat, scheduled)) ?? null;
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
  if (!holdsLead(seat, upcoming))
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
  if (state.checkpoint.prep_ended_at !== null)
    return conflict('Prep has ended and the speech is about to start');
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
  return prepConsumedOf(state.checkpoint, side) >= inRoundPrep.budgetMsPerSide
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
  return debateSideOf(seat) === active.side && holdsLead(seat, upcoming)
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
 * The floor moves only under an enabled policy, and only in a segment one
 * seat speaks in. A segment several seats speak in (cross-examination, an
 * open floor) never transfers the floor, so it has nothing to take.
 */
const interruptRefusal = (facts: RoundCommandFacts) => {
  const id = debateInvariantIds.interruptRequiresPolicy;
  const open = openRowOf(facts.state);
  const policy = facts.rules.interaction.interruptions;
  if (open === undefined || policy.allowed !== 'enabled')
    return violates(id, 'The resolved rules forbid interruptions here');
  if (facts.rules.segments[open.sequence]?.speak.rights !== 'one')
    return violates(
      id,
      'Nobody interrupts a segment several seats already speak in',
    );
  const remaining = segmentDueAtMs(open) - facts.nowMs;
  if (remaining < policy.minRemainingMs)
    return violates(id, 'Too little of the segment remains to interrupt');
  if (!isDebater(facts.seat))
    return conflict('Only a seated debater interrupts');
  return floorHolderOf(facts)?.id === facts.seat?.id
    ? violates(id, 'The floor holder cannot interrupt themselves')
    : null;
};

/**
 * Once the debate is over the Round waits for its ballot, so leaving has
 * nothing left to forfeit and must not pre-empt the judges (ADR 0070). A
 * forfeit hands the win to the other side, so only a two-sided Round decided
 * by a winner has one; anywhere else a debater who leaves is absent and the
 * Round goes on (TAB-6.2).
 */
const forfeitRefusal = ({ rules, state, seat }: RoundCommandFacts) => {
  if (debateHasEnded(state, rules.segments.length))
    return conflict('The debate is over; there is nothing to forfeit');
  if (debateSideOf(seat) === null) return conflict('A seated debater forfeits');
  return forfeitsToOpponent(rules)
    ? null
    : conflict('Only a two-sided Round is forfeited to the other side');
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

/** Why the Round takes no command at all now, or null when it takes one. */
const standingRefusal = (
  facts: RoundCommandFacts,
): RoundCommandRefusal | null => {
  const { status } = facts.state.lifecycle;
  if (status === 'completed')
    return violates(
      debateInvariantIds.completedIsTerminal,
      'Completed rounds are terminal',
    );
  if (status === 'abandoned')
    return conflict('An abandoned round takes no commands');
  if (facts.state.checkpoint.incident.phase !== 'none')
    return conflict('A platform incident holds this round');
  return null;
};

/** Why this seat may not run this command now, or null when it may. */
export const roundCommandRefusal = (
  facts: RoundCommandFacts,
  type: RoundCommand['type'],
): RoundCommandRefusal | null =>
  standingRefusal(facts) ?? refusals[type](facts);

/**
 * The commands this seat is offered now. An offered command can be illegal for
 * the moment (an Interrupt inside the protected end); one that is not offered
 * has no meaning for this seat here.
 */
export const roundCommandOptions = (
  facts: RoundCommandFacts,
): readonly RoundCommandOption[] => {
  const { rules, state, seat } = facts;
  if (
    !isDebater(seat) ||
    standingRefusal(facts) !== null ||
    debateHasEnded(state, rules.segments.length)
  )
    return [];
  const leave: readonly RoundCommandOption[] = forfeitsToOpponent(rules)
    ? [{ type: 'forfeit', legal: true }]
    : [];
  return [...floorOptions(facts, seat), ...leave];
};

/** What a debater may press about the floor now: start, prep, yield or interrupt. */
const floorOptions = (
  facts: RoundCommandFacts,
  seat: RoundParticipantSeat,
): readonly RoundCommandOption[] => {
  const option = (type: RoundCommand['type']): RoundCommandOption => ({
    type,
    legal: roundCommandRefusal(facts, type) === null,
  });
  const speech = option('start_speech');
  if (speech.legal) return [speech];
  const open = openRowOf(facts.state);
  if (open === undefined) {
    const prep = option('start_prep');
    return prep.legal ? [prep] : [];
  }
  const holds = floorHolderOf(facts)?.id === seat.id;
  const interrupts =
    facts.rules.interaction.interruptions.allowed === 'enabled' &&
    facts.rules.segments[open.sequence]?.speak.rights === 'one';
  return [
    ...(holds ? [option('yield')] : []),
    ...(interrupts ? [option('interrupt')] : []),
  ];
};
