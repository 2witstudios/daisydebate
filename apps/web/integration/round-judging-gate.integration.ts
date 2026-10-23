import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMaintenanceOperations } from '../src/features/round-finalization/maintenance';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { frozenBotJudgeRound } from './round-judging.test-support';
import { withRoomRuntime } from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('an AI judge never decides from a transcript frozen incomplete (DEC-208)', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId } = await frozenBotJudgeRound(f, false);
      const [window] =
        await f.sql`select (select count(*)::int from round_judging_jobs where round_id=${roundId}) jobs,
          r.ballot_deadline_at = z.frozen_at as closed
          from rounds r join round_transcript_freezes z on z.round_id=r.id where r.id=${roundId}`;
      await seedSettledAttendanceLedger(f, roundId);
      const instanceId = createId();
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      try {
        await createRoundMaintenanceOperations({
          store: f.store,
          instanceId,
          ids: { next: createId },
          evaluate: async () => null,
        }).finalize(roundId);
      } finally {
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
      }
      const done = (await f.store.getRound(roundId))!;
      const [receipt] =
        await f.sql`select result from round_commands where round_id=${roundId} and type='complete'`;
      const [spend] =
        await f.sql`select (select count(*)::int from agent_runs a join round_participants p on p.id=a.round_participant_id where p.round_id=${roundId}) runs,
          (select count(*)::int from rating_changes where round_id=${roundId}) ratings`;
      assert({
        given:
          'a Round judged only by an AI judge whose transcript froze incomplete',
        should:
          'queue no AI judging, close the ruling window at the freeze and complete with no outcome, a transcript-incomplete receipt, no provider run and no rating',
        actual: {
          window,
          done: [done.status, done.outcome],
          ruling: receipt?.result.ruling,
          spend,
        },
        expected: {
          window: { jobs: 0, closed: true },
          done: ['completed', null],
          ruling: 'transcript-incomplete',
          spend: { runs: 0, ratings: 0 },
        },
      });
    },
    {
      botBusyCap: 4,
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});
