import { createTabStore } from '../tab/store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Daisy Tab's commands and reads, each in one transaction fenced to its tenant, on the competitive lane. */
export const createTabCommandStore = (resources: DatabaseResources) =>
  namedLaneOperations({
    tabCommands: createTabStore(
      resourcesOf(resources).lane('competitive').database,
    ),
  });
export type TabCommandStore = ReturnType<typeof createTabCommandStore>;
