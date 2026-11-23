import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { createRoundIncidentStore as create } from '../round-incident-store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** The platform incident watch, on the competitive lane's bounded transaction. */
export const createRoundIncidentStore = (
  resources: DatabaseResources,
  options: {
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
  } = {},
) =>
  namedLaneOperations({
    roundIncidents: namedLaneOperations(
      create({
        run: resourcesOf(resources).bounded('competitive'),
        decisionRelease: options.decisionRelease,
      }),
    ),
  });
export type RoundIncidentStore = ReturnType<typeof createRoundIncidentStore>;
