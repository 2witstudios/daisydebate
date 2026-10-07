import type {
  DebateSide,
  RoundRules,
  RoundStage,
  RoundStatus,
  RuntimeCheckpoint,
} from '@daisy/protocol';
import type { RoundPosition } from './round-contracts';
import type { RoundStore } from './round-ecs-store';

const iso = (ms: number): string => new Date(ms).toISOString();

/** One durable segment row as the store holds it. */
type StoreRow = ReturnType<RoundStore['rows']>[number];

/** What the store says about the round's own lifecycle. */
type Lifecycle = ReturnType<RoundStore['lifecycle']>;

/** The stage the round is in, derived from its store; null when not active. */
export const stageOf = (
  on: RoundStore,
  status: RoundStatus,
): RoundStage | null => {
  if (status !== 'active') return null;
  if (on.openRow() !== undefined) return 'live';
  if (on.checkpoint().active_prep !== null) return 'prep';
  return 'countdown';
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
  lifecycle: Lifecycle,
  open: StoreRow | undefined,
  prepping: boolean,
  upcoming: RoundPosition['nextSegment'],
  now: number,
  countdownMs: number,
): number | null => {
  if (
    lifecycle.status !== 'active' ||
    open !== undefined ||
    prepping ||
    upcoming === null
  )
    return null;
  return Math.max(0, (lifecycle.gapAnchorMs ?? now) + countdownMs - now);
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
): RoundPosition['prepBudgetRemainingMs'] => {
  if (inRoundPrep === null) return null;
  const left = (side: DebateSide) =>
    Math.max(
      0,
      inRoundPrep.budgetMsPerSide - checkpoint.prep_consumed_ms[side],
    );
  return { affirmative: left('affirmative'), negative: left('negative') };
};

/** True while the final segment has spoken but the outcome is not in. */
const awaitingBallotOf = (
  status: RoundStatus,
  open: StoreRow | undefined,
  segmentCount: number,
  now: number,
): boolean =>
  status === 'active' &&
  open !== undefined &&
  open.sequence === segmentCount - 1 &&
  now >= open.startedAtMs + open.durationMs;

export const roundPositionOf = (
  on: RoundStore,
  now: number,
  rules: RoundRules,
): RoundPosition => {
  const lifecycle = on.lifecycle();
  const checkpoint = on.checkpoint();
  const rows = on.rows();
  const open = rows.find((row) => row.endedAtMs === null);
  const spoken = rows.filter((row) => row.endedAtMs !== null).length;
  const active = checkpoint.active_prep;
  const startable =
    lifecycle.status === 'scheduled' || lifecycle.status === 'active';
  const inRoundPrep = rules.inRoundPrep;
  const upcoming = nextSegmentOf(open, startable, spoken, rules);
  return {
    status: lifecycle.status,
    stage: stageOf(on, lifecycle.status),
    startedAt:
      lifecycle.startedAtMs === null ? null : iso(lifecycle.startedAtMs),
    completedAt:
      lifecycle.completedAtMs === null ? null : iso(lifecycle.completedAtMs),
    outcome: lifecycle.outcome,
    openSegment: openSegmentOf(
      open,
      rules,
      now,
      checkpoint.floor?.holder_participant_id ?? null,
    ),
    nextSegment: upcoming,
    countdownRemainingMs: countdownOf(
      lifecycle,
      open,
      active !== null,
      upcoming,
      now,
      rules.countdownMs,
    ),
    prep: prepOf(active, checkpoint, inRoundPrep?.budgetMsPerSide ?? 0, now),
    prepBudgetRemainingMs: prepBudgetOf(inRoundPrep, checkpoint),
    awaitingBallot: awaitingBallotOf(
      lifecycle.status,
      open,
      rules.segments.length,
      now,
    ),
  };
};
