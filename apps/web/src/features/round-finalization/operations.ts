import { createRoundRuntime } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';

export function roundTickProjection(
  nextSegmentId: () => string,
): Parameters<Database['finalizeDueRoundTranscript']>[0]['buildProjection'] {
  return ({ round, now }) =>
    createRoundRuntime({ ...round, round, nextSegmentId }).tick(now);
}
