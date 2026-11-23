import { moderationOperations } from '../moderation/store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Member restrictions (ADR 0103), on the control lane. */
export const createModerationStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...moderationOperations({ database: control, eventSink }),
  });
};
export type ModerationStore = ReturnType<typeof createModerationStore>;
