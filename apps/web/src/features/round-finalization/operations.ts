import { type RoundMaintenanceStore } from '@daisy/db/stores/round-maintenance';
import { advanceOpening, createRoundRuntime } from '@daisy/debate-engine';

type BuildProjection = Parameters<
  RoundMaintenanceStore['finalizeDueRoundTranscript']
>[0]['buildProjection'];

export function roundTickProjection(
  nextSegmentId: () => string,
): BuildProjection {
  return ({ round, now }) =>
    round.opening
      ? advanceOpening({
          ...round,
          round,
          nextSegmentId,
          opening: round.opening.state,
          seed: round.opening.seed,
          now,
        })
      : createRoundRuntime({ ...round, round, nextSegmentId }).tick(now);
}
