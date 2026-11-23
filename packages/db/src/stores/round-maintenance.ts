import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import type { RoundTimeSource } from '../round-execution-time';
import { roundMaintenanceOperations } from '../round-maintenance';
import { roundPanelCompletionOperations } from '../round-panel-completion';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** The Round maintenance sweep and panel completion, on the competitive lane's bounded transaction. */
export const createRoundMaintenanceStore = (
  resources: DatabaseResources,
  options: {
    readonly roundTime?: RoundTimeSource | undefined;
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
  } = {},
) => {
  const run = resourcesOf(resources).bounded('competitive');
  return namedLaneOperations({
    ...roundMaintenanceOperations(
      run,
      options.roundTime,
      options.decisionRelease,
    ),
    ...roundPanelCompletionOperations(
      run,
      options.roundTime,
      options.decisionRelease,
    ),
  });
};
export type RoundMaintenanceStore = ReturnType<
  typeof createRoundMaintenanceStore
>;
