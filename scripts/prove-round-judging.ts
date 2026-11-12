import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireTestSlotServices } from '@daisy/config';
import { createOpenRouter, judgeContractVersion } from '@daisy/ai-voice';
import { judgingJobRules } from '@daisy/debate-engine';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { isAppError } from '@daisy/errors';
import { TEST_RUN_MAX_MS } from '@daisy/redis/testing';
import { systemId } from '@daisy/clock';
import { withRunDatabase } from './test-run-database';
import { createProviderBudget } from '../apps/web/src/server/provider-budget';
import { createRoundJudgingOperations } from '../apps/web/src/features/round-judging/operations';

const model = process.argv[2],
  key = process.env.OPENROUTER_API_KEY;
if (!model || !key)
  throw Error(
    'Explicit model argument and configured OPENROUTER_API_KEY capability are required',
  );
const services = requireTestSlotServices(process.env);
await withRunDatabase({
  slotDatabaseUrl: services.databaseUrl,
  root: fileURLToPath(new URL('../', import.meta.url)),
  maxRunMs: TEST_RUN_MAX_MS,
  onSweep: () => {},
  work: async (run) => {
    process.env.TEST_DATABASE_URL = run.url;
    process.env.TEST_RUN_DATABASE = run.name;
    const { withRoomRuntime } =
      await import('../apps/web/integration/room-runtime.test-support');
    const { freezeBotJudge } =
      await import('../apps/web/integration/round-judging.test-support');
    await withRoomRuntime(
      async (f) => {
        const { roundId, target } = await freezeBotJudge(f);
        let calls = 0;
        const provider = createOpenRouter({
          apiKey: key,
          timeoutMs: 115000,
          fetch: (url, init) => {
            calls++;
            return globalThis.fetch(url, init);
          },
        });
        const operations = createRoundJudgingOperations({
          store: f.store,
          nextId: () => systemId.next(),
          voice: () => provider,
          withProvider: createProviderBudget(1),
        });
        const blocked = async (current: typeof claim) => {
          try {
            await operations.executeClaim(current, AbortSignal.timeout(115000));
          } catch (error) {
            if (isAppError(error) && error.reason === 'attendance-unsettled')
              return;
            throw error;
          }
          throw Error('Actual unresolved attendance must prevent completion');
        };
        // Coherency judging (ADR 0125): the first pass and the case map are
        // stored, each by its own claim, before the final ballot's claim.
        const due = () =>
          f.sql`update round_judging_jobs set retry_at=null where round_id=${roundId}`;
        for (let stage = 0; stage < 2; stage++) {
          const earlier = await f.store.claimRoundJudgingJob(target);
          await operations.executeClaim(earlier, AbortSignal.timeout(115000));
          await due();
        }
        const claim = await f.store.claimRoundJudgingJob(target);
        await blocked(claim);
        const [origin] =
          await f.sql`select requests,input_tokens,output_tokens from agent_runs where id=${claim.scope.agentRunId}`;
        await f.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
        const takeover = await f.store.claimRoundJudgingJob(target);
        await blocked(takeover);
        await blocked(takeover);
        const [job] =
          await f.sql`select pending_ballot is not null as cached,pending_ballot_epoch,attempts,case_map is not null as mapped,
            first_ballot is not null or first_ballot_failed as first_pass from round_judging_jobs where round_id=${roundId}`;
        const stages = (
          (await f.sql`select stage from round_judging_attempts where round_id=${roundId} order by job_epoch`) as {
            stage: string;
          }[]
        ).map((row) => row.stage);
        const [ballots] =
          await f.sql`select count(*)::int as count from ballots where judge_participant_id=${target.judgeParticipantId}`;
        if (
          calls !== 3 ||
          stages.join() !== 'first,map,final' ||
          !job.first_pass ||
          !job.mapped ||
          origin.requests !== 1 ||
          !job.cached ||
          job.pending_ballot_epoch !== 3 ||
          job.attempts !== 4 ||
          ballots.count !== 0
        )
          throw Error('Actual provider cached recovery proof failed');
        process.stdout.write(
          JSON.stringify({
            proof: 'actual-provider-frozen-judging-cache-recovery',
            model,
            providerCalls: calls,
            stages,
            inputTokens: origin.input_tokens,
            outputTokens: origin.output_tokens,
            frozenCoverage: 'incomplete',
            cached: true,
            takeoverEpoch: job.attempts,
            completion: 'blocked-by-actual-unresolved-attendance',
            fullRoundAcceptance: false,
          }) + '\n',
        );
      },
      {
        judging: {
          leaseMs: 60000,
          model,
          nextToken: () => randomBytes(32).toString('base64url'),
          // The production worker's judging options (round-worker-policy.ts).
          contractVersion: judgeContractVersion,
          rules: judgingJobRules,
          accountEligible: canUseAiAllowance,
        },
      },
    );
  },
});
