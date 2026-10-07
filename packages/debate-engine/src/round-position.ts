import type {
  DebateSide,
  HydratedSegment,
  RoundPosition,
  RoundRules,
  RoundStage,
  RoundStatus,
  RuntimeCheckpoint,
} from '@daisy/protocol';
import type { RoundStore } from './round-ecs-store';

export type { RoundPosition };

const iso = (ms: number): string => new Date(ms).toISOString();

/** One durable segment row as the store holds it. */
type StoreRow = ReturnType<RoundStore['rows']>[number];

/** Convert persisted ISO segment stamps to runtime clock rows. */
export const clockRowsOf = (segments: readonly HydratedSegment[]): StoreRow[] =>
  segments.map((segment) => ({
    id: segment.id,
    sequence: segment.sequence,
    type: segment.type,
    key: segment.rulesSegmentKey,
    startedAtMs: Date.parse(segment.startedAt),
    endedAtMs: segment.endedAt === null ? null : Date.parse(segment.endedAt),
    durationMs: segment.durationMs,
  }));

/** What the store says about the round's own lifecycle. */
type Lifecycle = ReturnType<RoundStore['lifecycle']>;

/**
 * The read surface a position is derived from: the durable rows, the
 * lifecycle and the checkpoint. The full runtime store satisfies it
 * structurally, and so does any client-side adapter over hydrated rows —
 * deriving a position never mutates, so the browser derives its view of
 * the round through this shape and never loads the ECS (whose codegen
 * needs `unsafe-eval`, refused by the nonce CSP; ADR 0024 §5).
 */
export type PositionStore = {
  readonly lifecycle: () => Lifecycle;
  readonly checkpoint: () => RuntimeCheckpoint;
  readonly rows: () => readonly StoreRow[];
  readonly openRow: () => StoreRow | undefined;
};

/** The lifecycle columns a position and a projection both carry, as ISO. */
export const lifecycleStampsOf = (lifecycle: Lifecycle) => ({
  startedAt: lifecycle.startedAtMs === null ? null : iso(lifecycle.startedAtMs),
  completedAt:
    lifecycle.completedAtMs === null ? null : iso(lifecycle.completedAtMs),
  outcome: lifecycle.outcome,
});

/** The stage the round is in, derived from its store; null when not active. */
export const stageOf = (
  on: PositionStore,
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

export const roundPositionOf = (
  on: PositionStore,
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
    ...lifecycleStampsOf(lifecycle),
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

const nextOpeningAt = (
  activePrep: RuntimeCheckpoint['active_prep'],
  prepConsumed: RuntimeCheckpoint['prep_consumed_ms'],
  gapAnchorMs: number | null,
  virtual: readonly StoreRow[],
  rules: RoundRules,
  now: number,
): number | null => {
  if (activePrep !== null)
    return (
      Date.parse(activePrep.started_at) +
      Math.max(
        0,
        (rules.inRoundPrep?.budgetMsPerSide ?? 0) -
          prepConsumed[activePrep.side],
      )
    );
  const spoken = virtual.filter((row) => row.endedAtMs !== null).length;
  if (rules.segments[spoken] === undefined) return null;
  return (gapAnchorMs ?? now) + rules.countdownMs;
};

const closeExpiredRow = (
  rows: readonly StoreRow[],
  open: StoreRow,
): StoreRow[] =>
  rows.map((row) =>
    row.id === open.id
      ? { ...row, endedAtMs: open.startedAtMs + open.durationMs }
      : row,
  );

const expiredAt = (
  open: StoreRow,
  segmentCount: number,
  now: number,
): number | null => {
  if (open.sequence === segmentCount - 1) return null;
  const endsAt = open.startedAtMs + open.durationMs;
  return now >= endsAt ? endsAt : null;
};

/**
 * The rows and checkpoint as the clock would have made them by `now`:
 * the client's virtual tick. Deriving a position on the browser cannot
 * write rows, so the same clock semantics the server persists — the
 * countdown opens the next segment, a spent segment closes unless it is
 * the final one, prep expiring opens its segment — are applied to a
 * copy, and the position reads the copy.
 */
export const advancedClockRowsOf = (
  rows: readonly StoreRow[],
  checkpoint: RuntimeCheckpoint,
  lifecycle: Lifecycle,
  rules: RoundRules,
  now: number,
): {
  readonly rows: readonly StoreRow[];
  readonly checkpoint: RuntimeCheckpoint;
} => {
  if (lifecycle.status !== 'active') return { rows, checkpoint };
  let virtual = [...rows];
  let activePrep = checkpoint.active_prep;
  const prepConsumed = { ...checkpoint.prep_consumed_ms };
  let gapAnchorMs = lifecycle.gapAnchorMs;
  for (;;) {
    const open = virtual.find((row) => row.endedAtMs === null);
    if (open !== undefined) {
      const endsAt = expiredAt(open, rules.segments.length, now);
      if (endsAt === null) break;
      virtual = closeExpiredRow(virtual, open);
      gapAnchorMs = endsAt;
      continue;
    }
    const opensAt = nextOpeningAt(
      activePrep,
      prepConsumed,
      gapAnchorMs,
      virtual,
      rules,
      now,
    );
    if (opensAt === null || now < opensAt) break;
    if (activePrep !== null) {
      // Prep expiry hands over to the next segment without a countdown.
      prepConsumed[activePrep.side] = rules.inRoundPrep?.budgetMsPerSide ?? 0;
      activePrep = null;
    }
    const spokenNow = virtual.filter((row) => row.endedAtMs !== null).length;
    const opening = rules.segments[spokenNow]!;
    gapAnchorMs = opensAt;
    virtual = [
      ...virtual,
      {
        id: `virtual-${opening.key}`,
        sequence: spokenNow,
        type: opening.type,
        key: opening.key,
        startedAtMs: opensAt,
        endedAtMs: null,
        durationMs: opening.durationMs,
      },
    ];
  }
  return {
    rows: virtual,
    checkpoint: {
      ...checkpoint,
      prep_consumed_ms: prepConsumed,
      active_prep: activePrep,
    },
  };
};
