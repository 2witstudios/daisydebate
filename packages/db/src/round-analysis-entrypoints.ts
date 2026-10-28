import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { createRoundAnalysisJobs } from './round-analysis-jobs';

export type RoundAnalysisOptions = Omit<
  Parameters<typeof createRoundAnalysisJobs>[0],
  'run'
>;
type Jobs = ReturnType<typeof createRoundAnalysisJobs>;

const configured = (jobs: Jobs | undefined): Jobs => {
  if (!jobs)
    throw createAppError(
      'INFRASTRUCTURE',
      'Round analysis policy is not configured',
    );
  return jobs;
};

/** Round analysis's own facade: absent options mean no job runs and scans are empty. */
export function roundAnalysisEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly roundAnalysis: RoundAnalysisOptions | undefined;
}) {
  const jobs = input.roundAnalysis
    ? createRoundAnalysisJobs({ run: input.run, ...input.roundAnalysis })
    : undefined;
  return {
    scanRoundAnalysisJobs: (...args: Parameters<Jobs['scan']>) =>
      jobs ? jobs.scan(...args) : Promise.resolve([]),
    claimRoundAnalysisJob: (...args: Parameters<Jobs['claim']>) =>
      configured(jobs).claim(...args),
    recordRoundAnalysisUsage: (...args: Parameters<Jobs['recordUsage']>) =>
      configured(jobs).recordUsage(...args),
    completeRoundAnalysisJob: (...args: Parameters<Jobs['complete']>) =>
      configured(jobs).complete(...args),
  };
}
