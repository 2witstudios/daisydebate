import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import {
  roundWorkerEntrypoints,
  type BotPublicationOptions,
  type JudgingOptions,
} from '../round-worker-entrypoints';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** The Round's leased workers, AI judging and bot publication, on the competitive lane's bounded transaction. */
export const createRoundWorkerStore = (
  resources: DatabaseResources,
  options: {
    readonly nextId: () => string;
    /** Required for completing a Round; absence refuses atomically, never defaults. */
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
    readonly judging?: JudgingOptions | undefined;
    readonly botPublication?: BotPublicationOptions | undefined;
  },
) =>
  namedLaneOperations(
    roundWorkerEntrypoints({
      decisionRelease: options.decisionRelease,
      run: resourcesOf(resources).bounded('competitive'),
      nextId: options.nextId,
      judging: options.judging,
      botPublication: options.botPublication,
    }),
  );
export type RoundWorkerStore = ReturnType<typeof createRoundWorkerStore>;
