import { instantMs } from '@daisy/clock';
import { clockStopsOf, prepConsumedOf } from '@daisy/protocol/round';
import { otherSide } from '@daisy/protocol/seats';
import { runningMs } from '@daisy/protocol/clock-stops';
import { winnerOutcome } from '@daisy/protocol/round-outcome';
import type { SideKey } from '@daisy/protocol/seats';
import type {
  RoundCommand,
  RoundParticipantSeat,
  RoundEffect,
} from '@daisy/protocol/runtime';
import type { RoundRules } from '@daisy/protocol/format';
import type { RoundOutcome } from '@daisy/protocol/round-outcome';
import { completedLifecycle, debateHasEnded } from './round-clock-state';
import {
  roundCommandRefusal,
  type RoundCommandFacts,
  type RoundCommandRefusal,
} from './round-command-legality';
import type { RoundStore } from './round-ecs-store';
import type { ClockChange } from './round-clock-transition';
import { interrupt, yieldFloor } from './round-floor';
import { debateInvariantIds } from './invariant-ids';
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
  /** The actors whose seats left this revision; the Room holds them no longer. */
  releasedMembers: string[];
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
  readonly sideOf: (actorId: string | null) => SideKey | null;
  readonly participants: readonly RoundParticipantSeat[];
  /** Seat completeness against `rules.seats`; a write-path invariant (ADR 0058 §8). */
  readonly assertSeatCompleteness: () => void;
  readonly closeRowAt: (sequence: number, at: number) => void;
};

const iso = (ms: number): string => new Date(ms).toISOString();

/** Only an opening Round starts; the clock anchors here. */
export const startRound = (c: CommandContext): void => {
  if (c.on.lifecycle().status !== 'opening')
    refuse('CONFLICT', 'Only an opening round starts');
  c.assertSeatCompleteness();
  c.on.setLifecycle({ status: 'active', startedAtMs: c.now });
  c.into.effects.push({ kind: 'round_started', at: iso(c.now) });
};

/**
 * Elective in-round prep: only a seated debater, only before their own
 * segment, only while the format's prep bounds and budget allow it.
 */
const startPrep = (c: CommandContext): void => {
  const side = c.sideOf(c.actorId);
  if (side === null) refuse('CONFLICT', 'Prep belongs to a seated debater');
  // Prep supersedes the rest of the countdown: the gap anchor hands over to
  // the prep clock anchored now.
  c.on.startPrep({ side, startedAtMs: c.now });
  // Prep closes the microphone the gate waited for: the next start gates afresh.
  c.on.setStartGate(null);
  c.into.effects.push({ kind: 'prep_started', side, at: iso(c.now) });
};

/**
 * Ending prep folds elapsed into it. The speech opens one microphone lead later, on the
 * clock, so capture has the speaker before their first word and prep stays private.
 */
const startSpeech = (c: CommandContext): void => {
  const active = c.on.checkpoint().active_prep;
  if (active === null)
    invariant(
      debateInvariantIds.startSpeechRequiresPrep,
      'A speech opens out of the prepping side’s prep',
    );
  const side = active.side;
  const elapsed = runningMs(
    instantMs(active.started_at),
    c.now,
    clockStopsOf(c.on.checkpoint()),
  );
  const budget = c.rules.inRoundPrep?.budgetMsPerSide ?? 0;
  const consumed = c.on.checkpoint().prep_consumed_ms;
  c.on.setPrepConsumed({
    ...consumed,
    [side]: Math.min(
      budget,
      prepConsumedOf(c.on.checkpoint(), side) + Math.max(0, elapsed),
    ),
  });
  c.on.endPrep();
  c.on.setPrepEndedAt(iso(c.now));
};

const stateOf = (c: CommandContext) => ({
  lifecycle: c.on.lifecycle(),
  checkpoint: c.on.checkpoint(),
  rows: c.on.rows(),
});

/** Whether every segment has closed: the debate is over and only its result is left. */
export const debateIsOver = (c: CommandContext): boolean =>
  debateHasEnded(stateOf(c), c.rules.segments.length);

/**
 * Forfeiting closes the round with the other side's win; legality admits it
 * only in a two-sided Round decided by a winner. Once the debate
 * is over the Round waits for its ballot, so leaving has nothing left to forfeit
 * and must not pre-empt the judges (ADR 0070). The runtime advances the clock
 * first, so a segment that ran out with no tick persisted counts as closed.
 */
const forfeit = (c: CommandContext): void => {
  const side = c.sideOf(c.actorId);
  if (side === null) refuse('CONFLICT', 'A seated debater forfeits');
  // A forfeit in the opening stands as a result, with no resolution before a
  // reveal; the record needs a start, so the Round starts and ends here.
  if (c.on.lifecycle().status === 'opening') startRound(c);
  closePlayedRound(c);
  completeWith(c, winnerOutcome(otherSide(c.rules.sides, side)));
};

/**
 * Leaving a Round no forfeit ends (TAB-6.8): the seat is absent from now on
 * and the Room holds its member no longer. Nothing else changes: the clock
 * runs on, and attendance decides each of its speeches on who is present,
 * abandoning the Round only once no speaking seat is.
 */
const leave = (c: CommandContext): void => {
  const seat = c.seatOf(c.actorId);
  if (seat === null) refuse('CONFLICT', 'A seated competitor leaves');
  c.on.markAbsent(seat.id);
  c.into.releasedMembers.push(seat.actorId);
};

/** Close actual played capture authority for either terminal decision. */
export function closePlayedRound(c: CommandContext): void {
  const open = c.on.openRow();
  if (open !== undefined) c.closeRowAt(open.sequence, c.now);
  c.on.endPrep();
  c.on.setPrepEndedAt(null);
  const lastPlayed = c.on.rows().at(-1)?.endedAtMs;
  if (lastPlayed !== undefined && lastPlayed !== null)
    c.into.finalPlayedEnd = iso(lastPlayed);
}

export const completeWith = (
  c: CommandContext,
  outcome: RoundOutcome,
): void => {
  c.on.setLifecycle(completedLifecycle(c.on.lifecycle(), outcome, c.now));
  c.into.effects.push({
    kind: 'round_completed',
    outcome,
    at: iso(c.now),
  });
};

const factsOf = (c: CommandContext): RoundCommandFacts => ({
  rules: c.rules,
  state: stateOf(c),
  participants: c.participants,
  seat: c.seatOf(c.actorId),
  nowMs: c.now,
});

const raise = (refusal: RoundCommandRefusal): never =>
  refusal.kind === 'conflict'
    ? refuse('CONFLICT', refusal.message)
    : invariant(refusal.id, refusal.message);

/**
 * Applies one legal command, or throws. A refusal leaves the store untouched
 * — the runtime restores it, so nothing a refused command queued survives
 * (ADR 0058 §6).
 */
export const applyRoundCommand = (
  c: CommandContext,
  command: RoundCommand,
): void => {
  const refusal = roundCommandRefusal(factsOf(c), command.type);
  if (refusal !== null) raise(refusal);
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
    case 'leave':
      return leave(c);
  }
};
