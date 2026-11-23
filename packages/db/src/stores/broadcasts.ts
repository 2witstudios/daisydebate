import { createBroadcastStore as create } from '../broadcast-store';
import { createRecordingCaptureStore } from '../recording-capture-store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Broadcast egress and the Recording capture it holds, on the competitive lane. */
export const createBroadcastStore = (resources: DatabaseResources) => {
  const database = resourcesOf(resources).lane('competitive').database;
  return namedLaneOperations({
    broadcasts: create(database),
    recordingCaptures: createRecordingCaptureStore(database),
  });
};
export type BroadcastStore = ReturnType<typeof createBroadcastStore>;
