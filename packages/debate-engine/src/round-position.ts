import type { RoundRules, RoundStage, RoundStatus } from '@daisy/protocol';

const iso = (ms: number): string => new Date(ms).toISOString();
import type { RoundPosition } from './round-contracts';
import type { RoundStore } from './round-ecs-store';

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

export const roundPositionOf = (
  on: RoundStore,
  now: number,
  rules: RoundRules,
): RoundPosition => {
  const lifecycle = on.lifecycle();
  const checkpoint = on.checkpoint();
  const allRows = on.rows();
  const open = allRows.find((row) => row.endedAtMs === null);
  const spoken = allRows.filter((row) => row.endedAtMs !== null).length;
  const active = checkpoint.active_prep;
  const startable =
    lifecycle.status === 'scheduled' || lifecycle.status === 'active';
  const upcomingSegment = rules.segments[spoken];
  const upcoming =
    open === undefined &&
    startable &&
    spoken < rules.segments.length &&
    upcomingSegment
      ? {
          key: upcomingSegment.key,
          label: upcomingSegment.label,
          type: upcomingSegment.type,
          side: upcomingSegment.side,
          sequence: spoken,
        }
      : null;
  const inRoundPrep = rules.inRoundPrep;
  return {
    status: lifecycle.status,
    stage: stageOf(on, lifecycle.status),
    startedAt:
      lifecycle.startedAtMs === null ? null : iso(lifecycle.startedAtMs),
    completedAt:
      lifecycle.completedAtMs === null ? null : iso(lifecycle.completedAtMs),
    outcome: lifecycle.outcome,
    openSegment:
      open === undefined
        ? null
        : {
            key: open.key,
            label: rules.segments[open.sequence]!.label,
            type: open.type,
            side: rules.segments[open.sequence]!.side,
            sequence: open.sequence,
            startedAt: iso(open.startedAtMs),
            endsAt: iso(open.startedAtMs + open.durationMs),
            remainingMs: Math.max(0, open.startedAtMs + open.durationMs - now),
            floorParticipantId: checkpoint.floor?.holder_participant_id ?? null,
          },
    nextSegment: upcoming,
    countdownRemainingMs:
      lifecycle.status === 'active' &&
      open === undefined &&
      active === null &&
      upcoming !== null
        ? Math.max(0, (lifecycle.gapAnchorMs ?? now) + rules.countdownMs - now)
        : null,
    prep:
      active === null
        ? null
        : {
            side: active.side,
            remainingMs: Math.max(
              0,
              (inRoundPrep?.budgetMsPerSide ?? 0) -
                checkpoint.prep_consumed_ms[active.side] -
                (now - Date.parse(active.started_at)),
            ),
          },
    prepBudgetRemainingMs:
      inRoundPrep === null
        ? null
        : {
            affirmative: Math.max(
              0,
              inRoundPrep.budgetMsPerSide -
                checkpoint.prep_consumed_ms.affirmative,
            ),
            negative: Math.max(
              0,
              inRoundPrep.budgetMsPerSide -
                checkpoint.prep_consumed_ms.negative,
            ),
          },
    awaitingBallot:
      lifecycle.status === 'active' &&
      open !== undefined &&
      open.sequence === rules.segments.length - 1 &&
      now >= open.startedAtMs + open.durationMs,
  };
};
