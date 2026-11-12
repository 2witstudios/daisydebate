import { stubCaseMap } from '@daisy/ai-voice/testing';
import { createRoundJudgingOperations } from './operations';
import {
  frozen,
  round,
} from '../round-runtime/transcript-evidence.test-support';

export const claim = {
  scope: {},
  token: 't',
  model: 'm',
  round,
  frozen,
} as never;
type Stage = 'first' | 'map' | 'final';
const nextStage: Record<Stage, Stage> = {
  first: 'map',
  map: 'final',
  final: 'final',
};
/** A fake store holding one job's stage, at the final stage unless told otherwise. */
export function harness(
  complete: (request: unknown) => Promise<unknown>,
  start: Stage = 'final',
) {
  const log = {
    provider: 0,
    saved: 0,
    submitted: 0,
    failures: [] as { category: string; final: boolean }[],
    usage: 0,
  };
  const job = {
    stage: start,
    caseMap: start === 'final' ? stubCaseMap : null,
    begun: [] as Stage[],
    stored: [] as Stage[],
  };
  const operations = createRoundJudgingOperations({
    store: {
      verifyRoundJudgingJob: async () => ({
        expectedVersion: 1,
        pendingBallot: null,
        stage: job.stage,
        caseMap: job.caseMap,
      }),
      beginRoundJudgingModelCall: async (
        _scope: unknown,
        _token: unknown,
        stage: Stage,
      ) => {
        job.begun.push(stage);
        return { kind: 'dispatched' as const };
      },
      saveRoundJudgingStage: async (
        _scope: unknown,
        _token: unknown,
        record: { stage: Stage; caseMap?: typeof stubCaseMap },
      ) => {
        job.stored.push(record.stage);
        if (record.caseMap) job.caseMap = record.caseMap;
        job.stage = nextStage[record.stage];
      },
      recordRoundJudgingUsage: async () => {
        log.usage++;
      },
      recordRoundJudgingAttemptFailure: async (
        _scope: unknown,
        _token: unknown,
        input: {
          diagnostic: { category: string };
          final: boolean;
        },
      ) => {
        log.failures.push({
          category: input.diagnostic.category,
          final: input.final,
        });
        if (job.stage === 'first') job.stage = 'map';
        return { kind: 'retry' };
      },
      saveRoundJudgingResult: async () => {
        log.saved++;
        return { kind: 'held' as const };
      },
      submitRoundJudgingResult: async () => {
        log.submitted++;
      },
    } as never,
    nextId: () => 'x'.repeat(24),
    voice: () =>
      ({
        complete: async (request: unknown) => {
          log.provider++;
          return complete(request);
        },
      }) as never,
    withProvider: (_signal, work) => work(),
  });
  return { log, job, operations };
}
export const reply = (text: string, finish = 'stop') => ({
  text,
  finish,
  refused: false,
  promptTokens: 5,
  completionTokens: 5,
});
