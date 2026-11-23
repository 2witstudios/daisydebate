import { formatOperations } from '../format-operations';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Formats and presets, on the competitive lane. */
export const createFormatsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    formatOperations({ database: lane('competitive').database, eventSink }),
  );
};
export type FormatsStore = ReturnType<typeof createFormatsStore>;
