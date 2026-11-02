import { judgingPolicy } from '@daisy/protocol';
import type { JudgingJobRules } from '../src/round-judging-jobs';

/**
 * The db never imports the engine, so its suites inject this stand-in for
 * @daisy/debate-engine's judgingJobRules. The real rules have their own unit
 * tests and run through the real workers in apps/web's judging suites.
 */
export const judgingJobRules: JudgingJobRules = {
  budgetSpent: (job, nowMs) =>
    !job.holdsBallot && Date.parse(job.generationDeadlineAt) <= nowMs,
  dispatchEnd: (input, nowMs) => {
    if (input.paidCalls >= judgingPolicy.maxPaidCalls)
      return 'attempts_exhausted';
    return Date.parse(input.generationDeadlineAt) <= nowMs
      ? 'generation_deadline'
      : null;
  },
};
