import { advanceOpening, createRoundRuntime } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';

type BuildProjection = Parameters<
  Database['finalizeDueRoundTranscript']
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
