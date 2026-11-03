import type {
  DebateSide,
  RoundCommand,
  RoundParticipantSeat,
  RoundRules,
  RatedOutcome,
  SegmentType,
  RoundEffect,
} from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';
import type { RoundStore } from './round-ecs-store';
import type { ClockChange } from './round-clock';
import { interrupt, yieldFloor } from './round-floor';
import { invariant, refuse } from './round-refusals';

/** The durable writes a command or tick queues for the caller to persist. */
export type Queues = {
  changes: ClockChange[];
  finalPlayedEnd: string | null;
  floorChange: {
    readonly sequence: number;
    readonly at: string;
    /** Null when the floor returns to the segment's scheduled seat. */
    readonly holder: string | null;
  } | null;
  effects: RoundEffect[];
};

/**
 * What one command needs from the runtime it was composed by. The dispatcher
 * is a pure function of this bag: the runtime keeps its store, its resolved
 * rules and its seat lookup here, and nothing else, so a command handler can
 * be read without the machine that built it (ADR 0058 §6 — ECS receives only
 * RoundRules and never re-derives them).
 */
export type CommandContext = {
  readonly rules: RoundRules;
  /** The store the command mutates; the runtime's own state, never a copy. */
  readonly on: RoundStore;
  /** Where the writes this command materializes are queued. */
  readonly into: Queues;
  readonly actorId: string | null;
  readonly now: number;
  /** How many segments have closed: the index of the next one to open. */
  readonly closedCount: () => number;
  readonly seatOf: (actorId: string | null) => RoundParticipantSeat | null;
  readonly sideOf: (actorId: string | null) => DebateSide | null;
  readonly floorHolder: (on: RoundStore) => RoundParticipantSeat | null;
  /** Seat completeness against `rules.seats`; a write-path invariant (ADR 0058 §8). */
  readonly assertSeatCompleteness: () => void;
  readonly openRowAt: (at: number) => void;
  readonly closeRowAt: (sequence: number, at: number) => void;
};

const iso = (ms: number): string => new Date(ms).toISOString();

const other = (side: DebateSide): DebateSide =>
  side === 'affirmative' ? 'negative' : 'affirmative';

/** Only an opening Round starts; the clock anchors here. */
export const startRound = (c: CommandContext): void => {
  if (c.on.lifecycle().status !== 'opening')
    refuse('CONFLICT', 'Only an opening round starts');
  c.assertSeatCompleteness();
  c.on.setLifecycle({ status: 'active', startedAtMs: c.now });
  c.into.effects.push({ kind: 'round_started', at: iso(c.now) });
};

/**
 * The segment the prepping side may spend prep before, or a named refusal:
 * it must exist, be the prepping side's own, sit inside the spendable
 * window, and not have passed the budget's expiry segment.
 */
const spendableSegmentOf = (
  c: CommandContext,
  inRoundPrep: NonNullable<RoundRules['inRoundPrep']>,
  side: DebateSide,
): { readonly key: string; readonly type: SegmentType } => {
  const sequence = c.closedCount();
  const upcoming = c.rules.segments[sequence];
  if (!upcoming)
    invariant(
      debateInvariantIds.prepRequiresSpendableSegment,
      'No segment remains to prep for',
    );
  if (upcoming.side !== side)
    invariant(
      debateInvariantIds.prepRequiresSpendableSegment,
      'Prep runs before the prepping side’s own segment',
    );
  if (!inRoundPrep.spendableBefore.includes(upcoming.type))
    invariant(
      debateInvariantIds.prepRequiresSpendableSegment,
      `Prep is not spendable before a ${upcoming.type} segment`,
    );
  const expiresAt = inRoundPrep.expiresAtSegment;
  if (
    expiresAt !== null &&
    c.rules.segments.findIndex((segment) => segment.key === expiresAt) <=
      sequence
  )
    invariant(
      debateInvariantIds.prepRequiresSpendableSegment,
      `Prep expired at segment ${expiresAt}`,
    );
  return upcoming;
};

/**
 * Elective in-round prep: only a seated debater, only before their own
 * segment, only while the format's prep bounds and budget allow it.
 */
const startPrep = (c: CommandContext): void => {
  if (c.on.lifecycle().status !== 'active')
    refuse('CONFLICT', 'Only an active round spends prep');
  if (c.on.openRow() !== undefined)
    refuse('CONFLICT', 'A segment is already live');
  if (c.on.checkpoint().active_prep !== null)
    refuse('CONFLICT', 'Prep is already running');
  const { inRoundPrep } = c.rules;
  if (inRoundPrep === null)
    invariant(
      debateInvariantIds.prepRequiresCapability,
      'The resolved rules have no in-round prep',
    );
  const side = c.sideOf(c.actorId);
  if (side === null) refuse('CONFLICT', 'Prep belongs to a seated debater');
  spendableSegmentOf(c, inRoundPrep, side);
  if (c.on.checkpoint().prep_consumed_ms[side] >= inRoundPrep.budgetMsPerSide)
    invariant(
      debateInvariantIds.prepRequiresBudget,
      'The side’s prep budget is spent',
    );
  // Prep supersedes the rest of the countdown: the gap anchor hands over to
  // the prep clock anchored now.
  c.on.startPrep({ side, startedAtMs: c.now });
  c.into.effects.push({ kind: 'prep_started', side, at: iso(c.now) });
};

/** A speech opens out of the prepping side's prep, folding elapsed into it. */
const startSpeech = (c: CommandContext): void => {
  const active = c.on.checkpoint().active_prep;
  if (active === null)
    invariant(
      debateInvariantIds.startSpeechRequiresPrep,
      'A speech opens out of the prepping side’s prep',
    );
  const side = c.sideOf(c.actorId);
  if (side === null || side !== active.side)
    refuse('CONFLICT', 'Only the prepping side ends its own prep');
  const elapsed = c.now - Date.parse(active.started_at);
  const budget = c.rules.inRoundPrep?.budgetMsPerSide ?? 0;
  c.on.setPrepConsumed(
    side,
    Math.min(
      budget,
      c.on.checkpoint().prep_consumed_ms[side] + Math.max(0, elapsed),
    ),
  );
  c.on.endPrep();
  c.openRowAt(c.now);
};

/** Whether every segment has closed: the debate is over and only its result is left. */
export const debateIsOver = (c: CommandContext): boolean =>
  c.closedCount() === c.rules.segments.length;

/**
 * Forfeiting closes the round with the other side's outcome. Once the debate
 * is over the Round waits for its ballot, so leaving has nothing left to forfeit
 * and must not pre-empt the judges (ADR 0070). The runtime advances the clock
 * first, so a segment that ran out with no tick persisted counts as closed.
 */
const forfeit = (c: CommandContext): void => {
  if (debateIsOver(c))
    refuse('CONFLICT', 'The debate is over; there is nothing to forfeit');
  const side = c.sideOf(c.actorId);
  if (side === null) refuse('CONFLICT', 'A seated debater forfeits');
  // A forfeit in the opening stands as a result, with no resolution before a
  // reveal; the record needs a start, so the Round starts and ends here.
  if (c.on.lifecycle().status === 'opening') startRound(c);
  closePlayedRound(c);
  completeWith(c, other(side));
};

/** Close actual played capture authority for either terminal decision. */
export function closePlayedRound(c: CommandContext): void {
  const open = c.on.openRow();
  if (open !== undefined) c.closeRowAt(open.sequence, c.now);
  c.on.endPrep();
  const lastPlayed = c.on.rows().at(-1)?.endedAtMs;
  if (lastPlayed !== undefined && lastPlayed !== null)
    c.into.finalPlayedEnd = iso(lastPlayed);
}

export const completeWith = (
  c: CommandContext,
  outcome: RatedOutcome,
): void => {
  c.on.setLifecycle({
    status: 'completed',
    outcome,
    completedAtMs: c.now,
  });
  c.into.effects.push({
    kind: 'round_completed',
    outcome,
    at: iso(c.now),
  });
};

/**
 * Applies one legal command, or throws. A refusal leaves the store untouched
 * — the runtime restores it, so nothing a refused command queued survives
 * (ADR 0058 §6).
 */
export const applyRoundCommand = (
  c: CommandContext,
  command: RoundCommand,
): void => {
  const status = c.on.lifecycle().status;
  if (status === 'completed')
    invariant(
      debateInvariantIds.completedIsTerminal,
      'Completed rounds are terminal',
    );
  if (status === 'abandoned')
    refuse('CONFLICT', 'An abandoned round takes no commands');
  switch (command.type) {
    case 'start_prep':
      return startPrep(c);
    case 'start_speech':
      return startSpeech(c);
    case 'yield':
      return yieldFloor(c);
    case 'interrupt':
      return interrupt(c);
    case 'forfeit':
      return forfeit(c);
  }
};
