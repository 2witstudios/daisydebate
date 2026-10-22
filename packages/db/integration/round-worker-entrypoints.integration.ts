import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createDatabase } from '../src/index';
import { createBotSeat } from './bot-seat.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
setupRitewayBun();
const services = requireTestServices(process.env);

test('configured root judging aliases share the owned pool and claim actual frozen input', async () =>
  withBoundedRound(async (fixture, _run, roundId, client) => {
    const seat = await createBotSeat(fixture, roundId, 'judge');
    await fixture.sql`update rounds set status='active',current_stage='live',started_at=clock_timestamp() where id=${roundId}`;
    await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,0,'incomplete')`;
    await fixture.sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status) values(${roundId},${seat.id},1,'queued')`;
    try {
      const inert = createDatabase({
        url: services.databaseUrl,
        client,
        maxConnections: 4,
        nextActorId: createId,
      });
      assert({
        given: 'no explicit Round worker policy',
        should: 'leave both worker discoveries inert',
        actual: [
          await inert.scanRoundJudgingJobs(64),
          await inert.scanRoundBotWorkers(64),
        ],
        expected: [[], []],
      });
      await assertRejects({
        given: 'a queued judge job without configured worker policy',
        should: 'refuse an execution capability',
        actual: () =>
          inert.claimRoundJudgingJob({ roundId, judgeParticipantId: seat.id }),
        code: 'INFRASTRUCTURE',
      });
      const generationScope = {
        roundId,
        agentRunId: createId(),
        roundParticipantId: seat.id,
        segmentId: createId(),
        serviceId: createId(),
        publicationEpoch: 1,
      };
      for (const attempt of [
        () =>
          inert.beginRoundBotGeneration(
            generationScope,
            'unconfigured-bearer',
            { kind: 'language' },
          ),
        () =>
          inert.finishRoundBotGeneration(
            generationScope,
            { id: createId(), token: 'unconfigured-execution' },
            'unknown',
            { inputTokens: 0, outputTokens: 0, characters: 0 },
          ),
      ])
        await assertRejects({
          given:
            'generation or usage settlement without explicit worker policy',
          should: 'expose a bound alias that truthfully refuses execution',
          actual: attempt,
          code: 'INFRASTRUCTURE',
        });
      const store = createDatabase({
        url: services.databaseUrl,
        client,
        maxConnections: 4,
        nextActorId: createId,
        judging: {
          leaseMs: 30000,
          model: 'fixture-judge',
          nextToken: () => randomBytes(32).toString('base64url'),
        },
      });
      const discovered = await store.scanRoundJudgingJobs(64);
      const claim = await store.claimRoundJudgingJob({
        roundId,
        judgeParticipantId: seat.id,
      });
      await store.verifyRoundJudgingJob(claim.scope, claim.token);
      const [job] =
        await fixture.sql`select status,attempts,lease_token_digest from round_judging_jobs where round_id=${roundId} and judge_participant_id=${seat.id}`;
      assert({
        given:
          'actual queued job and explicit root configuration on the supplied SQL pool',
        should:
          'discover and claim immutable revision through bound aliases without storing the bearer token',
        actual: {
          discovered: discovered.some(
            (item) =>
              item.roundId === roundId && item.judgeParticipantId === seat.id,
          ),
          revision: claim.frozen.revision,
          state: job.status,
          attempts: job.attempts,
          tokenHashed:
            job.lease_token_digest !== claim.token &&
            /^[0-9a-f]{64}$/.test(job.lease_token_digest),
        },
        expected: {
          discovered: true,
          revision: 1,
          state: 'leased',
          attempts: 1,
          tokenHashed: true,
        },
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  }));
