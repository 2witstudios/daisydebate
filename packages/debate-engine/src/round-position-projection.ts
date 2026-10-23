import type {
  DebateSide,
  RoundPosition,
  RoundRules,
  RoundStage,
  RoundStatus,
  RuntimeCheckpoint,
} from '@daisy/protocol';
import { advanceRoundClock } from './round-clock';
import {
  countdownAnchor,
  type ClockState,
  type ClockSegment as StoreRow,
  type Lifecycle,
} from './round-clock-state';
export type { RoundPosition };
const iso = (ms: number): string => new Date(ms).toISOString();

/** The lifecycle columns a position and a projection both carry, as ISO. */
export const lifecycleStampsOf = (lifecycle: Lifecycle) => ({
  startedAt: lifecycle.startedAtMs === null ? null : iso(lifecycle.startedAtMs),
  completedAt:
    lifecycle.completedAtMs === null ? null : iso(lifecycle.completedAtMs),
  outcome: lifecycle.outcome,
});

/** The stage the round is in, derived from its store; null when not active. */
export const stageOf = (
  on: ClockState,
  status: RoundStatus,
  segmentCount: number,
): RoundStage | null => {
  if (status !== 'active') return null;
  if (on.rows.find((row) => row.endedAtMs === null) !== undefined)
    return 'live';
  if (on.checkpoint.active_prep !== null) return 'prep';
  return on.rows.filter((row) => row.endedAtMs !== null).length === segmentCount
    ? 'live'
    : 'countdown';
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
): RoundPosition['openSegment'] => {
  if (open === undefined) return null;
  const segment = rules.segments[open.sequence]!;
  const endsAtMs = open.startedAtMs + open.durationMs;
  return {
    key: open.key,
    label: segment.label,
    type: open.type,
    side: segment.side,
    sequence: open.sequence,
    startedAt: iso(open.startedAtMs),
    endsAt: iso(endsAtMs),
    remainingMs: Math.max(0, endsAtMs - now),
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
  return Math.max(0, countdownAnchor(state) + countdownMs - now);
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
        (now - Date.parse(active.started_at)),
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
          ? Math.max(0, now - Date.parse(checkpoint.active_prep.started_at))
          : 0),
    );
  return { affirmative: left('affirmative'), negative: left('negative') };
};

/** True while the final segment has spoken but the outcome is not in. */
const awaitingBallotOf = (
  status: RoundStatus,
  open: StoreRow | undefined,
  spoken: number,
  segmentCount: number,
  now: number,
): boolean =>
  status === 'active' &&
  (spoken === segmentCount ||
    (open !== undefined &&
      open.sequence === segmentCount - 1 &&
      now >= open.startedAtMs + open.durationMs));

const roundPositionOf = (
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
  const startable =
    lifecycle.status === 'scheduled' || lifecycle.status === 'active';
  const inRoundPrep = rules.inRoundPrep;
  const upcoming = nextSegmentOf(open, startable, spoken, rules);
  return {
    status: lifecycle.status,
    stage: stageOf(on, lifecycle.status, rules.segments.length),
    ...lifecycleStampsOf(lifecycle),
    openSegment: openSegmentOf(
      open,
      rules,
      now,
      checkpoint.floor?.holder_participant_id ?? null,
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
    awaitingBallot: awaitingBallotOf(
      lifecycle.status,
      open,
      spoken,
      rules.segments.length,
      now,
    ),
  };
};

export const positionAtState = (
  state: ClockState,
  rules: RoundRules,
  nowMs: number,
): RoundPosition =>
  roundPositionOf(advanceRoundClock(state, rules, nowMs).state, nowMs, rules);
