import { recordingArchiveReadOperations } from '../recording-archive-reads';
import { recordingOperations } from '../recording-operations';
import { recordingRoundReadOperations } from '../recording-round-reads';
import { youthLiveReadOperations } from '../youth-live-reads';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Recordings: their Round, archive and Youth reads on the browse lane, their commands on the control lane. */
export const createRecordingStore = (resources: DatabaseResources) => {
  const { lane } = resourcesOf(resources);
  const browse = lane('browse').database;
  return namedLaneOperations({
    ...recordingRoundReadOperations({ database: browse }),
    ...youthLiveReadOperations({ database: browse }),
    ...recordingArchiveReadOperations({ database: browse }),
    ...recordingOperations({ database: lane('control').database }),
  });
};
export type RecordingStore = ReturnType<typeof createRecordingStore>;
