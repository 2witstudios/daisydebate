import { createAppError } from '@daisy/errors';
import { createRoundJudgingJobs } from './round-judging-jobs';
import { createBotPublicationOperations } from './bot-publication';
import { createRoundFeedbackJobs } from './round-feedback';
import type { BoundedTransaction } from './bounded-transaction';

export type JudgingOptions = Omit<
  Parameters<typeof createRoundJudgingJobs>[0],
  'run' | 'nextId'
>;
export type BotPublicationOptions = Omit<
  Parameters<typeof createBotPublicationOperations>[0],
  'run' | 'nextId'
>;
export type CoachingOptions = Omit<
  Parameters<typeof createRoundFeedbackJobs>[0],
  'run'
>;
type Coaching = ReturnType<typeof createRoundFeedbackJobs>;
type Jobs = ReturnType<typeof createRoundJudgingJobs>;
type Workers = ReturnType<typeof createBotPublicationOperations>;
function configured<T>(value: T | undefined): T {
  if (value === undefined)
    throw createAppError(
      'INFRASTRUCTURE',
      'Round worker policy is not configured',
    );
  return value;
}

/** The durable workers share the root's actual writer/watchdog admission counter. */
export function roundWorkerEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly judging: JudgingOptions | undefined;
  readonly botPublication: BotPublicationOptions | undefined;
  readonly coaching?: CoachingOptions | undefined;
}) {
  const coaching = input.coaching
    ? createRoundFeedbackJobs({ run: input.run, ...input.coaching })
    : undefined;
  const jobs = input.judging
    ? createRoundJudgingJobs({
        run: input.run,
        nextId: input.nextId,
        ...input.judging,
      })
    : undefined;
  const workers = input.botPublication
    ? createBotPublicationOperations({
        run: input.run,
        nextId: input.nextId,
        ...input.botPublication,
      })
    : undefined;
  return {
    scanRoundFeedbackJobs: (limit: number) =>
      coaching ? coaching.scan(limit) : Promise.resolve([]),
    claimRoundFeedbackJob: (...args: Parameters<Coaching['claim']>) =>
      configured(coaching).claim(...args),
    recordRoundFeedbackUsage: (...args: Parameters<Coaching['recordUsage']>) =>
      configured(coaching).recordUsage(...args),
    completeRoundFeedbackJob: (...args: Parameters<Coaching['complete']>) =>
      configured(coaching).complete(...args),
    scanRoundJudgingJobs: (limit: number) =>
      jobs ? jobs.scan(limit) : Promise.resolve([]),
    claimRoundJudgingJob: (...args: Parameters<Jobs['claim']>) =>
      configured(jobs).claim(...args),
    verifyRoundJudgingJob: (...args: Parameters<Jobs['verify']>) =>
      configured(jobs).verify(...args),
    renewRoundJudgingJob: (...args: Parameters<Jobs['renew']>) =>
      configured(jobs).renew(...args),
    beginRoundJudgingModelCall: (...args: Parameters<Jobs['beginModelCall']>) =>
      configured(jobs).beginModelCall(...args),
    recordRoundJudgingUsage: (...args: Parameters<Jobs['recordUsage']>) =>
      configured(jobs).recordUsage(...args),
    saveRoundJudgingResult: (...args: Parameters<Jobs['saveResult']>) =>
      configured(jobs).saveResult(...args),
    submitRoundJudgingResult: (...args: Parameters<Jobs['submitResult']>) =>
      configured(jobs).submitResult(...args),
    beginRoundBotGeneration: (
      ...args: Parameters<Workers['beginGeneration']>
    ) => configured(workers).beginGeneration(...args),
    finishRoundBotGeneration: (
      ...args: Parameters<Workers['finishGeneration']>
    ) => configured(workers).finishGeneration(...args),
    scanRoundBotWorkers: (limit: number) =>
      workers ? workers.scanWorkers(limit) : Promise.resolve([]),
    claimRoundBotWorker: (...args: Parameters<Workers['claimWorker']>) =>
      configured(workers).claimWorker(...args),
    verifyRoundBotWorker: (...args: Parameters<Workers['verifyBotWorker']>) =>
      configured(workers).verifyBotWorker(...args),
    renewRoundBotWorker: (...args: Parameters<Workers['renewWorker']>) =>
      configured(workers).renewWorker(...args),
    revokeRoundBotWorker: (...args: Parameters<Workers['revoke']>) =>
      configured(workers).revoke(...args),
    verifyRoundBotPublication: (
      ...args: Parameters<Workers['verifyBotPublication']>
    ) => configured(workers).verifyBotPublication(...args),
  };
}
