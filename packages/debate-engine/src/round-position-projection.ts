import { countdownDue } from './round-start-gate';
import {
  clockStopsOf,
  isRoundRunning,
  runningMs,
  segmentDueAtMs,
} from '@daisy/protocol';
import type {
  DebateSide,
  RoundLifecycle,
  RoundPosition,
  RoundRules,
  RoundStage,
  RuntimeCheckpoint,
} from '@daisy/protocol';
import { advanceRoundClock } from './round-clock';
import {
  debateHasEnded,
  lifecycleOver,
  startedAtOf,
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
  if (on.checkpoint.active_prep !== null) return 'prep';
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
  floorParticipantId: string | null,
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
    dueMs - (held === null ? now : Date.parse(held)),
  );
  const endsAtMs =
    held === null
      ? dueMs
      : (incident.phase === 'resuming' ? Date.parse(incident.until) : now) +
        remainingMs;
  return {
    key: open.key,
    label: segment.label,
    type: open.type,
    side: segment.side,
    sequence: open.sequence,
    startedAt: iso(open.startedAtMs),
    endsAt: iso(endsAtMs),
    remainingMs,
    floorParticipantId,
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
    side: segment.side,
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

/**
 * The running prep period and what is left of its budget. Elapsed time counts
 * against the budget while the period is live, which is why the checkpoint
 * stores an anchor rather than only a total (ADR 0058, BB).
 */
const prepOf = (
  active: RuntimeCheckpoint['active_prep'],
  checkpoint: RuntimeCheckpoint,
  budgetMsPerSide: number,
  now: number,
): RoundPosition['prep'] => {
  if (active === null) return null;
  return {
    side: active.side,
    remainingMs: Math.max(
      0,
      budgetMsPerSide -
        checkpoint.prep_consumed_ms[active.side] -
        runningMs(Date.parse(active.started_at), now, clockStopsOf(checkpoint)),
    ),
  };
};

/** Remaining budget per side; null when the format has no in-round prep. */
const prepBudgetOf = (
  inRoundPrep: RoundRules['inRoundPrep'],
  checkpoint: RuntimeCheckpoint,
  now: number,
): RoundPosition['prepBudgetRemainingMs'] => {
  if (inRoundPrep === null) return null;
  const left = (side: DebateSide) =>
    Math.max(
      0,
      inRoundPrep.budgetMsPerSide -
        checkpoint.prep_consumed_ms[side] -
        (checkpoint.active_prep?.side === side
          ? Math.max(
              0,
              runningMs(
                Date.parse(checkpoint.active_prep.started_at),
                now,
                clockStopsOf(checkpoint),
              ),
            )
          : 0),
    );
  return { affirmative: left('affirmative'), negative: left('negative') };
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
  const active = checkpoint.active_prep;
  const startable = isRoundRunning(lifecycle.status);
  const inRoundPrep = rules.inRoundPrep;
  const upcoming = nextSegmentOf(open, startable, spoken, rules);
  return {
    ...lifecycleColumnsOf(lifecycle),
    stage: stageOf(on, rules.segments.length),
    openSegment: openSegmentOf(
      open,
      rules,
      now,
      checkpoint.floor?.holder_participant_id ?? null,
      checkpoint.incident,
    ),
    nextSegment: upcoming,
    countdownRemainingMs: countdownOf(
      on,
      open,
      active !== null,
      upcoming,
      now,
      rules.countdownMs,
    ),
    prep: prepOf(active, checkpoint, inRoundPrep?.budgetMsPerSide ?? 0, now),
    prepBudgetRemainingMs: prepBudgetOf(inRoundPrep, checkpoint, now),
    incident: checkpoint.incident,
  };
};

export const positionAtState = (
  state: ClockState,
  rules: RoundRules,
  nowMs: number,
): RoundPosition =>
  roundPositionOf(advanceRoundClock(state, rules, nowMs).state, nowMs, rules);
