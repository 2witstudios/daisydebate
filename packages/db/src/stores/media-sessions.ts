import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { createMediaSessionStore as create } from '../media-session';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** A Round's media sessions and their reconcile, on the competitive lane. */
export const createMediaSessionStore = (
  resources: DatabaseResources,
  options: {
    readonly nextId: () => string;
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
  },
) => {
  const { lane, bounded } = resourcesOf(resources);
  return namedLaneOperations({
    mediaSessions: namedLaneOperations(
      create({
        decisionRelease: options.decisionRelease,
        database: lane('competitive').database,
        run: bounded('competitive'),
        nextId: options.nextId,
      }),
    ),
  });
};
export type MediaSessionStore = ReturnType<typeof createMediaSessionStore>;
