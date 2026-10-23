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

/** `scheduled` is the only status that starts; the clock anchors here. */
const start = (c: CommandContext): void => {
  if (c.on.lifecycle().status !== 'scheduled')
    refuse('CONFLICT', 'Only a scheduled round starts');
  c.assertSeatCompleteness();
  c.on.setLifecycle({
    status: 'active',
    startedAtMs: c.now,
  });
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

/** Forfeiting closes the round with the other side's outcome. */
const forfeit = (c: CommandContext): void => {
  const side = c.sideOf(c.actorId);
  if (side === null) refuse('CONFLICT', 'A seated debater forfeits');
  if (c.on.lifecycle().status === 'scheduled') {
    c.on.setLifecycle({
      status: 'abandoned',
      completedAtMs: c.now,
    });
    return;
  }
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

/** Completion follows the final segment's spent time, and carries an outcome. */
const complete = (c: CommandContext, outcome: RatedOutcome): void => {
  const open = c.on.openRow();
  const finalClosed =
    open === undefined && c.closedCount() === c.rules.segments.length;
  if (
    !finalClosed &&
    (open === undefined ||
      open.sequence !== c.rules.segments.length - 1 ||
      c.now < open.startedAtMs + open.durationMs)
  )
    invariant(
      debateInvariantIds.completeAfterFinalSegment,
      'Completion follows the final segment’s time',
    );
  if (open !== undefined) c.closeRowAt(open.sequence, c.now);
  c.on.endPrep();
  completeWith(c, outcome);
};

const completeWith = (c: CommandContext, outcome: RatedOutcome): void => {
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
    case 'start':
      return start(c);
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
    case 'complete':
      return complete(c, command.outcome);
  }
};
