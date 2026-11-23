import {
  roundAnalysisEntrypoints,
  type RoundAnalysisOptions,
} from '../round-analysis-entrypoints';
import { roundAnalysisReads } from '../round-analysis-reads';
import { roundAnalysisRetention } from '../round-analysis-retention';
import type { AiAllowanceOptions } from '../usage-ledger';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Round analysis (DEC-247): its own jobs on the control lane, its reads on the competitive lane. */
export const createRoundAnalysisStore = (
  resources: DatabaseResources,
  options: {
    readonly nextId: () => string;
    /** Round analysis's own jobs; absent, none run. */
    readonly roundAnalysis?: RoundAnalysisOptions | undefined;
    readonly aiAllowance?: AiAllowanceOptions | undefined;
  },
) => {
  const { bounded, lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations({
    ...roundAnalysisEntrypoints({
      run: bounded('control'),
      nextId: options.nextId,
      roundAnalysis: options.roundAnalysis,
      allowance: options.aiAllowance,
    }),
    ...roundAnalysisReads({
      database: lane('competitive').database,
      allowance: options.aiAllowance,
    }),
    ...roundAnalysisRetention({
      database: lane('control').database,
      eventSink,
    }),
  });
};
export type RoundAnalysisStore = ReturnType<typeof createRoundAnalysisStore>;
