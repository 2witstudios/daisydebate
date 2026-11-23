import { transcriptFinalizationOperations } from '../transcript-finalization';
import { transcriptRetention } from '../transcript-retention';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** A Round's transcript: its finalization on the competitive lane, its retention on the control lane. */
export const createTranscriptStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations({
    ...transcriptFinalizationOperations({
      database: lane('competitive').database,
    }),
    ...transcriptRetention({ database: lane('control').database, eventSink }),
  });
};
export type TranscriptStore = ReturnType<typeof createTranscriptStore>;
