import { audienceReactionOperations } from '../audience-reactions';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Audience reactions, on the social lane. */
export const createAudienceReactionsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    audienceReactionOperations({
      database: lane('social').database,
      eventSink,
    }),
  );
};
export type AudienceReactionsStore = ReturnType<
  typeof createAudienceReactionsStore
>;
