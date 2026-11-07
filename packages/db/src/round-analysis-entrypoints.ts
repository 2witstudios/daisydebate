import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { createRoundAnalysisJobs } from './round-analysis-jobs';
import { createRoundAnalysisRequests } from './round-analysis-requests';
import type { AiAllowanceOptions } from './usage-ledger';

export type RoundAnalysisOptions = Pick<
  Parameters<typeof createRoundAnalysisJobs>[0],
  'nextToken' | 'leaseMs' | 'model'
> & { readonly capacity: number };
type Jobs = ReturnType<typeof createRoundAnalysisJobs>;
const configured = (jobs: Jobs | undefined): Jobs => {
  if (!jobs)
    throw createAppError(
      'INFRASTRUCTURE',
      'Round analysis policy is not configured',
    );
  return jobs;
};
/** New generation requires the analysis worker and shared allowance policy; stored reads are separate. */
export function roundAnalysisEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly roundAnalysis: RoundAnalysisOptions | undefined;
  readonly allowance: AiAllowanceOptions | undefined;
}) {
  const jobs =
    input.roundAnalysis && input.allowance
      ? createRoundAnalysisJobs({
          run: input.run,
          nextId: input.nextId,
          ...input.roundAnalysis,
          accountEligible: input.allowance.accountEligible,
        })
      : undefined;
  const request =
    input.roundAnalysis && input.allowance
      ? createRoundAnalysisRequests({
          run: input.run,
          nextId: input.nextId,
          allowance: input.allowance,
          capacity: input.roundAnalysis.capacity,
        })
      : undefined;
  return {
    requestRoundAnalysis: (
      ...args: Parameters<ReturnType<typeof createRoundAnalysisRequests>>
    ) => {
      if (!request)
        throw createAppError(
          'INFRASTRUCTURE',
          'Round analysis policy is not configured',
        );
      return request(...args);
    },
    scanRoundAnalysisJobs: (...args: Parameters<Jobs['scan']>) =>
      jobs ? jobs.scan(...args) : Promise.resolve([]),
    claimRoundAnalysisJob: (...args: Parameters<Jobs['claim']>) =>
      configured(jobs).claim(...args),
    beginRoundAnalysisModelCall: (...args: Parameters<Jobs['dispatch']>) =>
      configured(jobs).dispatch(...args),
    recordRoundAnalysisOutcome: (...args: Parameters<Jobs['observe']>) =>
      configured(jobs).observe(...args),
    completeRoundAnalysisJob: (...args: Parameters<Jobs['complete']>) =>
      configured(jobs).complete(...args),
    retryRoundAnalysisJob: (...args: Parameters<Jobs['retry']>) =>
      configured(jobs).retry(...args),
  };
}
