import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireTestSlotServices } from '@daisy/config';
import { createOpenRouter } from '@daisy/ai-voice';
import { isAppError } from '@daisy/errors';
import { TEST_RUN_MAX_MS } from '@daisy/redis/testing';
import { systemId } from '@daisy/clock';
import { withRunDatabase } from './test-run-database';
import { createProviderCapacity } from '../apps/web/src/features/round-bots/provider-capacity';
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
        const claim = await f.store.claimRoundJudgingJob(target);
        let calls = 0;
        const provider = createOpenRouter({
          apiKey: key,
          timeoutMs: 55000,
          fetch: (url, init) => {
            calls++;
            return globalThis.fetch(url, init);
          },
        });
        const operations = createRoundJudgingOperations({
          store: f.store,
          nextId: () => systemId.next(),
          voice: () => provider,
          withProvider: createProviderCapacity(1),
        });
        const blocked = async (current: typeof claim) => {
          try {
            await operations.executeClaim(current, AbortSignal.timeout(55000));
          } catch (error) {
            if (
              isAppError(error) &&
              error.code === 'CONFLICT' &&
              error.message === 'attendance-unsettled'
            )
              return;
            throw error;
          }
          throw Error('Actual unresolved attendance must prevent completion');
        };
        await blocked(claim);
        const [origin] =
          await f.sql`select requests,input_tokens,output_tokens from agent_runs where id=${claim.scope.agentRunId}`;
        await f.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
        const takeover = await f.store.claimRoundJudgingJob(target);
        await blocked(takeover);
        await blocked(takeover);
        const [job] =
          await f.sql`select pending_ballot is not null as cached,pending_ballot_epoch,attempts from round_judging_jobs where round_id=${roundId}`;
        const [ballots] =
          await f.sql`select count(*)::int as count from ballots where judge_participant_id=${target.judgeParticipantId}`;
        if (
          calls !== 1 ||
          origin.requests !== 1 ||
          !job.cached ||
          job.pending_ballot_epoch !== 1 ||
          job.attempts !== 2 ||
          ballots.count !== 0
        )
          throw Error('Actual provider cached recovery proof failed');
        process.stdout.write(
          JSON.stringify({
            proof: 'actual-provider-frozen-judging-cache-recovery',
            model,
            providerCalls: calls,
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
        botBusyCap: 4,
        judging: {
          leaseMs: 60000,
          model,
          nextToken: () => randomBytes(32).toString('base64url'),
        },
      },
    );
  },
});
