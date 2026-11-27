import { instantMs } from '@daisy/clock/instant';
import { countdownDue } from './round-start-gate';
import {
  clockStopsOf,
  isRoundRunning,
  prepConsumedOf,
} from '@daisy/protocol/round';
import { leadSeatOf, sideKeysOf } from '@daisy/protocol/format-seating';
import { runningMs } from '@daisy/protocol/clock-stops';
import { segmentDueAtMs } from '@daisy/protocol/segment-end';
import type { SideKey } from '@daisy/protocol/seats';
import type { RoundLifecycle } from '@daisy/protocol/round-lifecycle';
import type { RoundPosition } from '@daisy/protocol/runtime';
import type { RoundRules } from '@daisy/protocol/format';
import type { RoundStage, RuntimeCheckpoint } from '@daisy/protocol/round';
import { advanceRoundClock } from './round-clock';
import {
  offerLapsesAtMs,
  offerWindowOf,
  pointEndsAtMs,
  pointsOfInformationIn,
} from './round-point-of-information';
import {
  debateHasEnded,
  type ClockState,
  type ClockSegment as StoreRow,
  type Lifecycle,
} from './round-clock-state';
export type { RoundPosition };
const iso = (ms: number): string => new Date(ms).toISOString();

/** The lifecycle columns a position and a projection both carry, as ISO. */
export const lifecycleColumnsOf = (lifecycle: Lifecycle): RoundLifecycle => {
  switch (lifecycle.status) {
    case 'opening':
      return {
        status: lifecycle.status,
        startedAt: null,
        completedAt: null,
        outcome: null,
      };
    case 'active':
      return {
        status: lifecycle.status,
        startedAt: iso(lifecycle.startedAtMs),
        completedAt: null,
        outcome: null,
      };
    case 'completed':
      return {
        status: lifecycle.status,
        startedAt: iso(lifecycle.startedAtMs),
        completedAt: iso(lifecycle.completedAtMs),
        outcome: lifecycle.outcome,
      };
    case 'abandoned':
      return {
        status: lifecycle.status,
        startedAt:
          lifecycle.startedAtMs === null ? null : iso(lifecycle.startedAtMs),
        completedAt: iso(lifecycle.completedAtMs),
        outcome: null,
      };
  }
};

/** The stage the round is in, derived from its store; null when not active. */
export const stageOf = (
  on: ClockState,
  segmentCount: number,
): RoundStage | null => {
  if (on.lifecycle.status !== 'active') return null;
  if (on.rows.find((row) => row.endedAtMs === null) !== undefined)
    return 'live';
  if (on.checkpoint.prep.phase === 'running') return 'prep';
  return debateHasEnded(on, segmentCount) ? 'awaiting_ballot' : 'countdown';
};

/**
 * The segment currently holding the floor, or null. Its label and side come
 * from the resolved rules rather than the row, because a row names the key it
 * executes and the rules are what that key means (ADR 0058 §6).
 */
const openSegmentOf = (
  open: StoreRow | undefined,
  rules: RoundRules,
  now: number,
  incident: RuntimeCheckpoint['incident'],
): RoundPosition['openSegment'] => {
  if (open === undefined) return null;
  const segment = rules.segments[open.sequence]!;
  const dueMs = segmentDueAtMs(open);
  // Held by an incident the speech is frozen at its resume point, so the clock
  // shows what is really owed, and it runs again from the countdown's end.
  const held = incident.phase !== 'none' ? incident.resume_point : null;
  const remainingMs = Math.max(
    0,
    dueMs - (held === null ? now : instantMs(held)),
  );
  const endsAtMs =
    held === null
      ? dueMs
      : (incident.phase === 'resuming' ? instantMs(incident.until) : now) +
        remainingMs;
  return {
    key: open.key,
    label: segment.label,
    type: open.type,
    lead: leadSeatOf(segment.speak),
    speak: segment.speak,
    sequence: open.sequence,
    startedAt: iso(open.startedAtMs),
    endsAt: iso(endsAtMs),
    remainingMs,
  };
};

/**
 * The segment that will open next. It exists only while the round is
 * startable, nothing is live, and the grammar has one left — so an abandoned
 * or completed round reports none.
 */
const nextSegmentOf = (
  open: StoreRow | undefined,
  startable: boolean,
  spoken: number,
  rules: RoundRules,
): RoundPosition['nextSegment'] => {
  if (open !== undefined || !startable || spoken >= rules.segments.length)
    return null;
  const segment = rules.segments[spoken];
  if (segment === undefined) return null;
  return {
    key: segment.key,
    label: segment.label,
    type: segment.type,
    lead: leadSeatOf(segment.speak),
    speak: segment.speak,
    sequence: spoken,
  };
};

/** Time left on the inter-segment countdown; null when it is not running. */
const countdownOf = (
  state: ClockState,
  open: StoreRow | undefined,
  prepping: boolean,
  upcoming: RoundPosition['nextSegment'],
  now: number,
  countdownMs: number,
): number | null => {
  if (
    state.lifecycle.status !== 'active' ||
    open !== undefined ||
    prepping ||
    upcoming === null
  )
    return null;
  // To the due instant, then zero through any hold: only the clock's own opening reads the
  // gate, so a held floor change never shows a countdown jumping up and back down.
  return Math.max(0, countdownDue(state, countdownMs, now) - now);
};

/** Running time a running prep has used so far; never negative, whatever the clocks say. */
const prepRunningMs = (checkpoint: RuntimeCheckpoint, now: number): number =>
  checkpoint.prep.phase === 'running'
    ? Math.max(
        0,
        runningMs(
          instantMs(checkpoint.prep.started_at),
          now,
          clockStopsOf(checkpoint),
        ),
      )
    : 0;

/**
 * Prep called for the next segment, or running with what is left of its
 * budget. Elapsed time counts against the budget while it runs, which is why
 * the checkpoint stores an anchor rather than only a total (ADR 0058, BB).
 */
const prepOf = (
  checkpoint: RuntimeCheckpoint,
  budgetMsPerSide: number,
  now: number,
): RoundPosition['prep'] => {
  const { prep } = checkpoint;
  switch (prep.phase) {
    case 'called':
      return { phase: 'called', side: prep.side };
    case 'running':
      return {
        phase: 'running',
        side: prep.side,
        remainingMs: Math.max(
          0,
          budgetMsPerSide -
            prepConsumedOf(checkpoint, prep.side) -
            prepRunningMs(checkpoint, now),
        ),
      };
    case 'idle':
    case 'lead':
      return null;
  }
};

/** Remaining budget per side; null when the format has no in-round prep. */
const prepBudgetOf = (
  rules: Pick<RoundRules, 'inRoundPrep' | 'sides'>,
  checkpoint: RuntimeCheckpoint,
  now: number,
): RoundPosition['prepBudgetRemainingMs'] => {
  const { inRoundPrep } = rules;
  if (inRoundPrep === null) return null;
  const { prep } = checkpoint;
  const left = (side: SideKey) =>
    Math.max(
      0,
      inRoundPrep.budgetMsPerSide -
        prepConsumedOf(checkpoint, side) -
        (prep.phase === 'running' && prep.side === side
          ? prepRunningMs(checkpoint, now)
          : 0),
    );
  return Object.fromEntries(
    sideKeysOf(rules).map((side) => [side, left(side)]),
  );
};

/** Whether the budget died at its expiry segment: no prep is spendable again. */
const prepExpiredOf = (rules: RoundRules, spoken: number): boolean => {
  const expiresAt = rules.inRoundPrep?.expiresAtSegment ?? null;
  if (expiresAt === null) return false;
  const index = rules.segments.findIndex((segment) => segment.key === expiresAt);
  return index >= 0 && index <= spoken;
};

/** The open speech's points of information, if it takes them. */
const pointOfInformationOf = (
  open: StoreRow | undefined,
  rules: RoundRules,
  checkpoint: RuntimeCheckpoint,
  now: number,
): RoundPosition['pointOfInformation'] => {
  if (open === undefined) return null;
  const rule = pointsOfInformationIn(rules, open.sequence);
  if (rule === null) return null;
  const { opensAtMs, closesAtMs } = offerWindowOf(open, rule);
  const point = checkpoint.point_of_information;
  const endsAtMs =
    point.phase === 'speaking' ? pointEndsAtMs(point.accepted_at, rule) : null;
  return {
    offersOpenAt: iso(opensAtMs),
    offersCloseAt: iso(closesAtMs),
    offers:
      point.phase === 'offered'
        ? point.offers.map((offer) => ({
            participantId: offer.participant_id,
            lapsesAt: iso(offerLapsesAtMs(offer.offered_at, rule, closesAtMs)),
          }))
        : [],
    holder:
      point.phase === 'speaking' && endsAtMs !== null
        ? {
            participantId: point.holder_participant_id,
            endsAt: iso(endsAtMs),
            remainingMs: Math.max(0, endsAtMs - now),
          }
        : null,
  };
};

export const roundPositionOf = (
  on: ClockState,
  now: number,
  rules: RoundRules,
): RoundPosition => {
  const lifecycle = on.lifecycle;
  const checkpoint = on.checkpoint;
  const rows = on.rows;
  const open = rows.find((row) => row.endedAtMs === null);
  const spoken = rows.filter((row) => row.endedAtMs !== null).length;
  const startable = isRoundRunning(lifecycle.status);
  const inRoundPrep = rules.inRoundPrep;
  const upcoming = nextSegmentOf(open, startable, spoken, rules);
  return {
    ...lifecycleColumnsOf(lifecycle),
    stage: stageOf(on, rules.segments.length),
    openSegment: openSegmentOf(open, rules, now, checkpoint.incident),
    nextSegment: upcoming,
    countdownRemainingMs: countdownOf(
      on,
      open,
      checkpoint.prep.phase === 'running',
      upcoming,
      now,
      rules.countdownMs,
    ),
    prep: prepOf(checkpoint, inRoundPrep?.budgetMsPerSide ?? 0, now),
    prepBudgetRemainingMs: prepBudgetOf(rules, checkpoint, now),
    prepExpired: prepExpiredOf(rules, open === undefined ? spoken : spoken + 1),
    pointOfInformation: pointOfInformationOf(open, rules, checkpoint, now),
    incident: checkpoint.incident,
  };
};

export const positionAtState = (
  state: ClockState,
  rules: RoundRules,
  nowMs: number,
): RoundPosition =>
  roundPositionOf(advanceRoundClock(state, rules, nowMs).state, nowMs, rules);
