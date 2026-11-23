import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { createRoundStartGateStore as create } from '../round-start-gate-store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** A Round's start gate, on the competitive lane's bounded transaction. */
export const createRoundStartGateStore = (
  resources: DatabaseResources,
  options: {
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
  } = {},
) =>
  namedLaneOperations({
    roundStartGates: namedLaneOperations(
      create({
        run: resourcesOf(resources).bounded('competitive'),
        decisionRelease: options.decisionRelease,
      }),
    ),
  });
export type RoundStartGateStore = ReturnType<typeof createRoundStartGateStore>;
