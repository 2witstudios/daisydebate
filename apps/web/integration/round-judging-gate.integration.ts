import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../src/features/round-finalization/maintenance';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  assembleJudgedRoom,
  fixtureBallot,
  frozenBotJudgeRound,
  playOut,
} from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

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
          startHorizonMs: ROUND_START_HORIZON_MS,
          store: f.store,
          instanceId,
          ids: { next: createId },
          evaluate: async () => null,
        }).finalize(roundId);
      } finally {
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
      }
      const done = (await f.store.getRound(roundId))!;
      const view = await f.store.readLaunchedRound(roundId, f.host, () => true);
      const [receipt] =
        await f.sql`select result from round_commands where round_id=${roundId} and type='complete'`;
      const [spend] =
        await f.sql`select (select count(*)::int from agent_runs a join round_participants p on p.id=a.round_participant_id where p.round_id=${roundId}) runs,
          (select count(*)::int from rating_changes where round_id=${roundId}) ratings`;
      assert({
        given:
          'a Round judged only by an AI judge whose transcript froze incomplete',
        should:
          'queue no AI judging, close the ruling window at the freeze and complete with no outcome, a transcript-incomplete receipt the Round view carries, no provider run and no rating',
        actual: {
          window,
          done: [done.status, done.outcome],
          ruling: [receipt?.result.ruling, view.unjudgedRuling],
          spend,
        },
        expected: {
          window: { jobs: 0, closed: true },
          done: ['completed', null],
          ruling: ['transcript-incomplete', 'transcript-incomplete'],
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

test('a mixed panel on an incomplete freeze completes once its human judge rules, before the deadline (ISSUE-466-r2)', async () =>
  withRoomRuntime(
    async (f) => {
      const bot = await f.bot();
      let room = await assembleJudgedRoom(f, 2);
      room = (
        await f.command(f.outsider, room, {
          type: 'claim-seat',
          role: 'judge',
          slot: 0,
        })
      ).view;
      room = (
        await f.command(f.host, room, {
          type: 'assign-seat',
          role: 'judge',
          slot: 1,
          actorId: bot.actorId,
        })
      ).view;
      for (const caller of [f.host, f.guest, f.outsider])
        room = (
          await f.consent(
            caller,
            await f.operations.view(caller, room.id),
            'ready',
          )
        ).view;
      const { roundId } = await startRuntimeRound(f, room);
      await playOut(f, roundId, false);
      const frozen = await finalizeAsWeb(f, roundId);
      await seedSettledAttendanceLedger(f, roundId);
      const round = (await f.store.getRound(roundId))!;
      const [human, ai] = [f.outsider.actorId, bot.actorId].map(
        (actorId) => round.participants.find((p) => p.actorId === actorId)!.id,
      );
      await createRoundBallotOperations({
        store: f.store,
        nextBallotId: createId,
        nextSegmentId: createId,
      }).submit({ kind: 'human', actorId: f.outsider.actorId }, roundId, {
        version: 1,
        commandId: createId(),
        expectedVersion: round.version,
        judgeParticipantId: human!,
        freezeRevision: 1,
        ballot: fixtureBallot(
          'The negative answered the decisive clash.',
          'negative',
        ),
      });
      const instanceId = createId();
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      try {
        await createRoundMaintenanceOperations({
          startHorizonMs: ROUND_START_HORIZON_MS,
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
        await f.sql`select result, (select ballot_deadline_at > clock_timestamp() from rounds where id=${roundId}) early from round_commands where round_id=${roundId} and type='complete'`;
      const [jobs] =
        await f.sql`select count(*)::int n from round_judging_jobs where round_id=${roundId}`;
      assert({
        given:
          'a human and an AI judge on an incomplete freeze, with the human ballot submitted inside the ballot window',
        should:
          'complete at once with the human ruling and the AI seat as no ruling, never queueing AI judging',
        actual: {
          completeness:
            frozen.status === 'frozen' ? frozen.freeze.completeness : null,
          done: [done.status, done.outcome],
          receipt: [
            receipt?.result.ruling,
            receipt?.result.noRuling,
            receipt?.early,
          ],
          jobs: jobs?.n,
        },
        expected: {
          completeness: 'incomplete',
          done: ['completed', 'negative'],
          receipt: ['partial', [ai], true],
          jobs: 0,
        },
      });
    },
    { botBusyCap: 4 },
  ));
