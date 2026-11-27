import { isAbsentSeat, prepConsumedOf } from '@daisy/protocol/round';
import {
  isDebatingSeat,
  sameSeat,
  sideOfSeat,
  type SideKey,
} from '@daisy/protocol/seats';
import { leadSeatOf } from '@daisy/protocol/format-seating';
import {
  type RoundCommand,
  type RoundParticipantSeat,
} from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import { forfeitsToOpponent } from './round-outcome';
import { debateInvariantIds } from './invariant-ids';
import {
  closedCount,
  debateHasEnded,
  type ClockSegment,
  type ClockState,
} from './round-clock-state';
import {
  offerWindowOf,
  pointsOfInformationIn,
} from './round-point-of-information';

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

/**
 * A command this seat could press now, exactly as it would be sent (with the
 * segment it names), and whether the engine would accept it.
 */
export type RoundCommandOption = {
  readonly command: RoundCommand;
  readonly legal: boolean;
};

type Refusal = RoundCommandRefusal | null;

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

/** The side a segment's scheduled seat argues for; null without one. */
const leadSideOf = (
  segment: RoundRules['segments'][number] | undefined,
): SideKey | null => {
  const lead = segment === undefined ? null : leadSeatOf(segment.speak);
  return lead === null ? null : sideOfSeat(lead);
};

/** The participant scheduled to a segment, if any. */
const scheduledSeatOf = (
  { rules, participants }: Pick<RoundCommandFacts, 'rules' | 'participants'>,
  sequence: number,
): RoundParticipantSeat | null =>
  participants.find((seat) => holdsLead(seat, rules.segments[sequence])) ??
  null;

/**
 * The segment prep is for now: the one after the live segment (prep called
 * ahead starts when it ends), or the one the gap leads to (INTX-2).
 */
export const prepTargetOf = (state: ClockState): number => {
  const open = openRowOf(state);
  return open === undefined ? closedCount(state) : open.sequence + 1;
};

/** A press names the segment it meant; any other is stale, never applied (INTX-7). */
const stale = (expected: number, named: number): Refusal =>
  expected === named
    ? null
    : conflict('That segment has already changed; the press is stale');

/**
 * Prep may be spent before this segment by this side: the format has prep, the
 * segment exists and is the side's own, its type is spendable, the budget has
 * not expired, and some of it is left.
 */
const prepSpendableRefusal = (
  { rules, state }: RoundCommandFacts,
  side: SideKey,
  target: number,
): Refusal => {
  const { inRoundPrep } = rules;
  if (inRoundPrep === null)
    return violates(
      debateInvariantIds.prepRequiresCapability,
      'The resolved rules have no in-round prep',
    );
  const id = debateInvariantIds.prepRequiresSpendableSegment;
  const upcoming = rules.segments[target];
  if (!upcoming) return violates(id, 'No segment remains to prep for');
  if (leadSideOf(upcoming) !== side)
    return violates(id, 'Prep runs before the prepping side’s own segment');
  if (!inRoundPrep.spendableBefore.includes(upcoming.type))
    return violates(
      id,
      `Prep is not spendable before a ${upcoming.type} segment`,
    );
  const expiresAt = inRoundPrep.expiresAtSegment;
  if (
    expiresAt !== null &&
    rules.segments.findIndex((segment) => segment.key === expiresAt) <= target
  )
    return violates(id, `Prep expired at segment ${expiresAt}`);
  return prepConsumedOf(state.checkpoint, side) >= inRoundPrep.budgetMsPerSide
    ? violates(
        debateInvariantIds.prepRequiresBudget,
        'The side’s prep budget is spent',
      )
    : null;
};

/**
 * Either debater of the side that speaks next calls prep, during the previous
 * segment or in the gap (INTX-2). Only one prep exists at a time.
 */
const startPrepRefusal = (
  facts: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'start_prep' }>,
): Refusal => {
  const { rules, state, seat } = facts;
  if (state.lifecycle.status !== 'active')
    return conflict('Only an active round spends prep');
  if (rules.inRoundPrep === null)
    return violates(
      debateInvariantIds.prepRequiresCapability,
      'The resolved rules have no in-round prep',
    );
  const side = debateSideOf(seat);
  if (!isDebater(seat) || side === null)
    return conflict('Prep belongs to a seated debater');
  const target = prepTargetOf(state);
  const staleness = stale(target, command.sequence);
  if (staleness !== null) return staleness;
  switch (state.checkpoint.prep.phase) {
    case 'called':
      return conflict('Prep is already called');
    case 'running':
      return conflict('Prep is already running');
    case 'lead':
      return conflict('Prep has ended and the speech is about to start');
    case 'idle':
      return prepSpendableRefusal(facts, side, target);
  }
};

/** A side takes back the prep it called, before the segment it waits on ends. */
const cancelPrepRefusal = (
  { state, seat }: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'cancel_prep' }>,
): Refusal => {
  const { prep } = state.checkpoint;
  if (prep.phase !== 'called') return conflict('No prep is called');
  const staleness = stale(prepTargetOf(state), command.sequence);
  if (staleness !== null) return staleness;
  return isDebater(seat) && debateSideOf(seat) === prep.side
    ? null
    : conflict('Only the side that called prep cancels it');
};

/** Either debater of the prepping side ends its running prep (INTX-3). */
const startSpeechRefusal = (
  { state, seat }: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'start_speech' }>,
): Refusal => {
  const { prep } = state.checkpoint;
  // Prep that ran out an instant before the press is a race, not corruption.
  if (prep.phase === 'lead')
    return conflict('Prep has already ended and the speech is about to start');
  if (prep.phase !== 'running')
    return violates(
      debateInvariantIds.startSpeechRequiresPrep,
      'A speech opens out of the prepping side’s prep',
    );
  const staleness = stale(closedCount(state), command.sequence);
  if (staleness !== null) return staleness;
  return isDebater(seat) && debateSideOf(seat) === prep.side
    ? null
    : conflict('Only the prepping side ends its own prep');
};

/**
 * The scheduled seat ends its own segment early. In cross-examination the
 * asker always may, whatever the speech-yield setting (ADR 0096, INTX-9), and
 * a person on the answering side may when a bot asks, since a bot never ends
 * one itself.
 */
const yieldRefusal = (
  facts: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'yield' }>,
): Refusal => {
  const { rules, state, seat } = facts;
  const id = debateInvariantIds.yieldRequiresFloor;
  const open = openRowOf(state);
  if (open === undefined) return violates(id, 'Yielding requires a live segment');
  const staleness = stale(open.sequence, command.sequence);
  if (staleness !== null) return staleness;
  const segment = rules.segments[open.sequence];
  if (segment?.type === 'cross_ex') {
    if (holdsLead(seat, segment)) return null;
    const asker = scheduledSeatOf(facts, open.sequence);
    const answering =
      isDebater(seat) &&
      seat.kind === 'human' &&
      debateSideOf(seat) !== null &&
      debateSideOf(seat) !== leadSideOf(segment);
    return asker?.kind === 'bot' && answering
      ? null
      : violates(id, 'Only the asker ends cross-examination early');
  }
  if (!holdsLead(seat, segment))
    return violates(id, 'Only the scheduled seat ends its own segment');
  return rules.interaction.yield?.allowed === true
    ? null
    : violates(id, 'The resolved rules forbid yielding');
};

/** The live speech a point-of-information command names, under its rule. */
const pointContext = (
  facts: RoundCommandFacts,
  sequence: number,
):
  | { readonly refusal: RoundCommandRefusal }
  | {
      readonly refusal: null;
      readonly speaker: RoundParticipantSeat | null;
      readonly opensAtMs: number;
      readonly closesAtMs: number;
    } => {
  const open = openRowOf(facts.state);
  const id = debateInvariantIds.pointOfInformationRequiresRule;
  if (open === undefined)
    return { refusal: violates(id, 'Points of information need a live speech') };
  const staleness = stale(open.sequence, sequence);
  if (staleness !== null) return { refusal: staleness };
  const rule = pointsOfInformationIn(facts.rules, open.sequence);
  if (rule === null)
    return {
      refusal: violates(id, 'This segment takes no points of information'),
    };
  return {
    refusal: null,
    speaker: scheduledSeatOf(facts, open.sequence),
    ...offerWindowOf(open, rule),
  };
};

/**
 * A seat of another side stands to offer during the speech's unprotected time
 * (INTX-13). The speaker's partner never offers; a bot never offers, and no
 * one offers to a bot speaker (INTX-17).
 */
const offerRefusal = (
  facts: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'offer_poi' }>,
): Refusal => {
  const context = pointContext(facts, command.sequence);
  if (context.refusal !== null) return context.refusal;
  const { seat, nowMs } = facts;
  const { speaker } = context;
  if (!isDebater(seat)) return conflict('Only a seated debater offers');
  if (speaker === null || speaker.id === seat.id)
    return conflict('The speaker does not offer to their own speech');
  const speakerSide = debateSideOf(speaker);
  if (speakerSide !== null && debateSideOf(seat) === speakerSide)
    return conflict('Only the other side offers a point of information');
  if (seat.kind === 'bot') return conflict('A bot does not offer');
  if (speaker.kind === 'bot')
    return conflict('A bot speaker takes no points of information');
  if (nowMs < context.opensAtMs)
    return conflict('The speech’s protected start is still running');
  if (nowMs >= context.closesAtMs)
    return conflict('The speech’s protected end has begun');
  const point = facts.state.checkpoint.point_of_information;
  if (point.phase === 'speaking')
    return conflict('A point of information is being given');
  return point.phase === 'offered' &&
    point.offers.some((offer) => offer.participant_id === seat.id)
    ? conflict('This seat is already offering')
    : null;
};

/** A standing offer is its seat's own to withdraw. */
const withdrawRefusal = (
  facts: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'withdraw_poi' }>,
): Refusal => {
  const context = pointContext(facts, command.sequence);
  if (context.refusal !== null) return context.refusal;
  const point = facts.state.checkpoint.point_of_information;
  const seat = facts.seat;
  return seat !== null &&
    point.phase === 'offered' &&
    point.offers.some((offer) => offer.participant_id === seat.id)
    ? null
    : conflict('This seat has no standing offer');
};

/** Only the speaker answers offers. */
const speakerRefusal = (
  facts: RoundCommandFacts,
  speaker: RoundParticipantSeat | null,
): Refusal =>
  speaker !== null && facts.seat?.id === speaker.id
    ? null
    : conflict('Only the speaker answers points of information');

/** The speaker takes one standing offer, before the protected end (INTX-14). */
const acceptRefusal = (
  facts: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'accept_poi' }>,
): Refusal => {
  const context = pointContext(facts, command.sequence);
  if (context.refusal !== null) return context.refusal;
  const notSpeaker = speakerRefusal(facts, context.speaker);
  if (notSpeaker !== null) return notSpeaker;
  if (facts.nowMs >= context.closesAtMs)
    return conflict('The speech’s protected end has begun');
  const point = facts.state.checkpoint.point_of_information;
  return point.phase === 'offered' &&
    point.offers.some(
      (offer) => offer.participant_id === command.offererParticipantId,
    )
    ? null
    : conflict('That offer is no longer standing');
};

/** The speaker declines every standing offer at once. */
const declineRefusal = (
  facts: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'decline_poi' }>,
): Refusal => {
  const context = pointContext(facts, command.sequence);
  if (context.refusal !== null) return context.refusal;
  const notSpeaker = speakerRefusal(facts, context.speaker);
  if (notSpeaker !== null) return notSpeaker;
  return facts.state.checkpoint.point_of_information.phase === 'offered'
    ? null
    : conflict('No offer is standing');
};

/** The holder concludes, or the speaker resumes, before the point's limit (INTX-15). */
const endPointRefusal = (
  facts: RoundCommandFacts,
  command: Extract<RoundCommand, { type: 'end_poi' }>,
): Refusal => {
  const context = pointContext(facts, command.sequence);
  if (context.refusal !== null) return context.refusal;
  const point = facts.state.checkpoint.point_of_information;
  if (point.phase !== 'speaking')
    return conflict('No point of information is being given');
  const id = facts.seat?.id;
  return id !== undefined &&
    (id === point.holder_participant_id || id === context.speaker?.id)
    ? null
    : conflict('Only the speaker or the point’s holder ends it');
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

/**
 * Leaving a Round no forfeit ends (TAB-6.8): a seated competitor, while the
 * debate runs, leaves and is absent from then on; the Round goes on, and
 * attendance abandons it only once no speaking seat is present. A two-sided
 * Round decided by a winner is forfeited instead.
 */
const leaveRefusal = ({ rules, state, seat }: RoundCommandFacts) => {
  if (debateHasEnded(state, rules.segments.length))
    return conflict('The debate is over; there is nothing to leave');
  if (!isDebater(seat)) return conflict('A seated competitor leaves');
  if (forfeitsToOpponent(rules))
    return conflict('A two-sided Round is forfeited, not left');
  return state.lifecycle.status === 'active'
    ? null
    : conflict('Only a running debate is left');
};

/** A seat that left is absent from then on: it commands nothing more. */
const absentRefusal = ({ state, seat }: RoundCommandFacts) =>
  seat !== null && isAbsentSeat(state.checkpoint, seat.id)
    ? conflict('This seat has left the Round')
    : null;

/** Why this command, as named, is illegal for this seat now. */
const commandRefusal = (
  facts: RoundCommandFacts,
  command: RoundCommand,
): Refusal => {
  switch (command.type) {
    case 'start_prep':
      return startPrepRefusal(facts, command);
    case 'cancel_prep':
      return cancelPrepRefusal(facts, command);
    case 'start_speech':
      return startSpeechRefusal(facts, command);
    case 'yield':
      return yieldRefusal(facts, command);
    case 'offer_poi':
      return offerRefusal(facts, command);
    case 'withdraw_poi':
      return withdrawRefusal(facts, command);
    case 'accept_poi':
      return acceptRefusal(facts, command);
    case 'decline_poi':
      return declineRefusal(facts, command);
    case 'end_poi':
      return endPointRefusal(facts, command);
    case 'forfeit':
      return forfeitRefusal(facts);
    case 'leave':
      return leaveRefusal(facts);
  }
};

/** Why the Round takes no command at all now, or null when it takes one. */
const standingRefusal = (facts: RoundCommandFacts): Refusal => {
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
  command: RoundCommand,
): Refusal =>
  standingRefusal(facts) ?? absentRefusal(facts) ?? commandRefusal(facts, command);

/**
 * The commands this seat is offered now, each as it would be sent. An offered
 * command can be illegal for the moment (an offer inside protected time); one
 * that is not offered has no meaning for this seat here.
 */
export const roundCommandOptions = (
  facts: RoundCommandFacts,
): readonly RoundCommandOption[] => {
  const { rules, state, seat } = facts;
  if (
    !isDebater(seat) ||
    standingRefusal(facts) !== null ||
    absentRefusal(facts) !== null ||
    debateHasEnded(state, rules.segments.length)
  )
    return [];
  const option = (command: RoundCommand): RoundCommandOption => ({
    command,
    legal: roundCommandRefusal(facts, command) === null,
  });
  // Leaving forfeits a two-sided winner Round; anywhere else it is absence.
  const leave = option(
    forfeitsToOpponent(rules) ? { type: 'forfeit' } : { type: 'leave' },
  );
  return [
    ...prepOptions(facts, seat).map(option),
    ...segmentOptions(facts, seat).map(option),
    leave,
  ];
};

/** What this seat may press about prep now: call, cancel or end it. */
const prepOptions = (
  { rules, state }: RoundCommandFacts,
  seat: RoundParticipantSeat,
): readonly RoundCommand[] => {
  const side = debateSideOf(seat);
  if (rules.inRoundPrep === null || side === null) return [];
  const { prep } = state.checkpoint;
  const target = prepTargetOf(state);
  switch (prep.phase) {
    case 'running':
      return prep.side === side
        ? [{ type: 'start_speech', sequence: closedCount(state) }]
        : [];
    case 'called':
      return prep.side === side
        ? [{ type: 'cancel_prep', sequence: target }]
        : [];
    case 'lead':
      return [];
    case 'idle': {
      // Offered before every segment of the side's the format lets prep
      // precede; spent or expired, it stays offered and illegal.
      const upcoming = rules.segments[target];
      return upcoming !== undefined &&
        leadSideOf(upcoming) === side &&
        rules.inRoundPrep.spendableBefore.includes(upcoming.type)
        ? [{ type: 'start_prep', sequence: target }]
        : [];
    }
  }
};

/** What this seat may press in the live segment: end it, or its points of information. */
const segmentOptions = (
  facts: RoundCommandFacts,
  seat: RoundParticipantSeat,
): readonly RoundCommand[] => {
  const open = openRowOf(facts.state);
  if (open === undefined) return [];
  const sequence = open.sequence;
  const segment = facts.rules.segments[sequence];
  const ends: readonly RoundCommand[] =
    yieldRefusal(facts, { type: 'yield', sequence }) === null ||
    holdsLead(seat, segment)
      ? [{ type: 'yield', sequence }]
      : [];
  if (pointsOfInformationIn(facts.rules, sequence) === null) return ends;
  const point = facts.state.checkpoint.point_of_information;
  const speaker = scheduledSeatOf(facts, sequence);
  if (speaker?.id === seat.id) {
    if (point.phase === 'offered')
      return [
        ...ends,
        ...point.offers.map(
          (offer): RoundCommand => ({
            type: 'accept_poi',
            sequence,
            offererParticipantId: offer.participant_id,
          }),
        ),
        { type: 'decline_poi', sequence },
      ];
    if (point.phase === 'speaking') return [...ends, { type: 'end_poi', sequence }];
    return ends;
  }
  if (point.phase === 'speaking' && point.holder_participant_id === seat.id)
    return [{ type: 'end_poi', sequence }];
  const opposes =
    speaker !== null &&
    speaker.kind === 'human' &&
    seat.kind === 'human' &&
    (debateSideOf(speaker) === null ||
      debateSideOf(seat) !== debateSideOf(speaker));
  if (!opposes) return ends;
  const offering =
    point.phase === 'offered' &&
    point.offers.some((offer) => offer.participant_id === seat.id);
  return [
    ...ends,
    offering
      ? { type: 'withdraw_poi', sequence }
      : { type: 'offer_poi', sequence },
  ];
};
