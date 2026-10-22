import { createRoundRuntime } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';

export function roundTickProjection(
  nextSegmentId: () => string,
): Parameters<Database['finalizeRoundTranscript']>[0]['buildProjection'] {
  return ({ round, now }) =>
    createRoundRuntime({ ...round, round, nextSegmentId }).tick(now);
}

/** Internal service work uses the same engine and durable Round clock as commands. */
export function createRoundFinalizationOperations(input: {
  readonly store: Pick<Database, 'finalizeRoundTranscript'>;
  readonly nextSegmentId: () => string;
}) {
  return {
    finalize: (roundId: string) =>
      input.store.finalizeRoundTranscript({
        roundId,
        buildProjection: roundTickProjection(input.nextSegmentId),
      }),
  };
}
