/** How long an undecided window waits before its evidence is read again. */
const EVALUATION_RETRY_MS = 5_000;
/** The longest wait after repeated stage failures. */
const RETRY_MAX_MS = 60_000;

export type MaintenanceStage = 'tick' | 'evaluate' | 'finalize';
type StagePacing = { readonly retryAtMs: number; readonly failures: number };
/** One Round's maintenance backoff and hold, so a known-blocked Round costs little and says why. */
export type RoundPacing = {
  readonly stages: Readonly<Partial<Record<MaintenanceStage, StagePacing>>>;
  /** Since when an uncertain check-in writer has held this Round. */
  readonly heldSinceMs: number | null;
};
export type PacingEvent =
  | { readonly on: 'stage_ok'; readonly stage: 'tick' | 'finalize' }
  | { readonly on: 'stage_failed'; readonly stage: MaintenanceStage }
  | {
      readonly on: 'evaluated';
      readonly found: 'undecided' | 'held' | 'decided';
    };

export const noPacing: RoundPacing = { stages: {}, heldSinceMs: null };

const without = (
  stages: RoundPacing['stages'],
  stage: MaintenanceStage,
): RoundPacing['stages'] => {
  return Object.fromEntries(
    Object.entries(stages).filter(([name]) => name !== stage),
  );
};

/** The pure transition: one Round's pacing after one event at one instant. */
export function nextPacing(
  pacing: RoundPacing,
  event: PacingEvent,
  nowMs: number,
): RoundPacing {
  if (event.on === 'stage_ok')
    return { ...pacing, stages: without(pacing.stages, event.stage) };
  if (event.on === 'stage_failed') {
    const failures = (pacing.stages[event.stage]?.failures ?? 0) + 1;
    const waitMs = EVALUATION_RETRY_MS * 2 ** (failures - 1);
    return {
      ...pacing,
      stages: {
        ...pacing.stages,
        [event.stage]: {
          failures,
          retryAtMs: nowMs + Math.min(waitMs, RETRY_MAX_MS),
        },
      },
    };
  }
  const heldSinceMs =
    event.found === 'held' ? (pacing.heldSinceMs ?? nowMs) : null;
  return {
    heldSinceMs,
    stages:
      event.found === 'decided'
        ? without(pacing.stages, 'evaluate')
        : {
            ...pacing.stages,
            evaluate: { failures: 0, retryAtMs: nowMs + EVALUATION_RETRY_MS },
          },
  };
}

export const stageDue = (
  pacing: RoundPacing,
  stage: MaintenanceStage,
  nowMs: number,
): boolean =>
  nowMs >= (pacing.stages[stage]?.retryAtMs ?? Number.NEGATIVE_INFINITY);
