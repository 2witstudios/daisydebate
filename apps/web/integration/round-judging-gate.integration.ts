import { createId } from '@paralleldrive/cuid2';
import { withSeasons } from '@daisy/db/seasons';
import { buildRoundTopic } from '@daisy/protocol';
import { recoverRatedResults } from './rated-room.test-support';
import { roundWaitingOn } from '@daisy/debate-engine';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitHumanBallot } from './round-judging.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  assembleJudgedRoom,
  everyoneReady,
  fixtureBallot,
  frozenBotJudgeRound,
  playOut,
} from './round-judging.test-support';
import {
  finalizeAsWeb,
  finalizeByMaintenance,
} from './round-maintenance.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
import { botAdmissionForTests } from './bot-admission.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('an AI judge never decides from a transcript frozen incomplete (DEC-208)', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId } = await frozenBotJudgeRound(f, false);
      const [window] =
        await f.sql`select (select count(*)::int from round_judging_jobs where round_id=${roundId}) jobs,
          r.ballot_deadline_at is null as closed
          from rounds r join round_transcript_freezes z on z.round_id=r.id where r.id=${roundId}`;
      await seedSettledAttendanceLedger(f, roundId);
      await finalizeByMaintenance(f, roundId);
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
          'queue no AI judging, open no human window and complete with no outcome, a transcript-incomplete receipt the Round view carries, no provider run and no rating',
        actual: {
          window,
          done: [done.status, done.outcome],
          ruling: [receipt?.result.ruling, view.panelRuling],
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
      ...botAdmissionForTests,
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});

test('a mixed panel on an incomplete freeze completes once its human judge rules, before the deadline (ISSUE-466-r2)', async () =>
  withRoomRuntime(async (f) => {
    const bot = await f.aiJudge();
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
    room = await everyoneReady(f, room, [f.host, f.guest, f.outsider]);
    const { roundId } = await startRuntimeRound(f, room);
    await playOut(f, roundId, false);
    const frozen = await finalizeAsWeb(f, roundId);
    await seedSettledAttendanceLedger(f, roundId);
    const round = (await f.store.getRound(roundId))!;
    const ai = round.participants.find((p) => p.actorId === bot.actorId)!.id;
    await submitHumanBallot(
      f,
      roundId,
      f.outsider.actorId,
      1,
      fixtureBallot('The negative answered the decisive clash.', 'negative'),
    );
    await finalizeByMaintenance(f, roundId);
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
  }, botAdmissionForTests));

const judgingOptions = {
  ...botAdmissionForTests,
  judging: {
    leaseMs: 60000,
    model: 'fixture-model',
    nextToken: () => randomBytes(32).toString('base64url'),
  },
};

test('a failed AI judge ends a rated Round honestly: no human countdown, no winner, no rating, Room released', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId } = await frozenBotJudgeRound(f, true);
    await f.sql`update rounds set competition_type='ranked',format_id='freestyle',format_version=1,preset_version=1,ladder_id='freestyle' where id=${roundId}`;
    const seen = () =>
      f.store.readLaunchedRound(roundId, f.host, () => true, roundWaitingOn);
    const processing = await seen();
    const [row] =
      await f.sql`select ballot_deadline_at from rounds where id=${roundId}`;
    await seedSettledAttendanceLedger(f, roundId);
    await f.sql`update round_judging_jobs set status='failed',terminal_reason='attempts_exhausted' where round_id=${roundId}`;
    const failed = await seen();
    await finalizeByMaintenance(f, roundId);
    const done = (await f.store.getRound(roundId))!;
    const view = await seen();
    const [facts] =
      await f.sql`select (select count(*)::int from rating_changes where round_id=${roundId}) as ratings,
        (select count(*)::int from room_active_memberships m join rounds r on r.room_id=m.room_id where r.id=${roundId}) as held`;
    assert({
      given:
        'a ranked Round whose only judge is an AI with a job that ran out of calls',
      should:
        'show AI processing with no human window, then failure, then complete with no winner or rating and hold nobody',
      actual: {
        processing: processing.waitingOn?.state,
        humanDeadline: row.ballot_deadline_at,
        failed: failed.waitingOn?.state,
        done: [done.status, done.outcome],
        ruling: view.panelRuling,
        terminalStatus: view.waitingOn,
        ...facts,
      },
      expected: {
        processing: 'ai_processing',
        humanDeadline: null,
        failed: 'ai_failed',
        done: ['completed', null],
        ruling: 'judging-failed',
        terminalStatus: null,
        ratings: 0,
        held: 0,
      },
    });
  }, judgingOptions);
});

test('on a ranked Round, a failed AI judge blocks no human ballot, and the room shows the persisted window', async () => {
  await withRoomRuntime(async (f) => {
    const seasonId = createId();
    const bot = await f.aiJudge();
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
    room = await everyoneReady(f, room, [f.host, f.guest, f.outsider]);
    const { roundId } = await startRuntimeRound(f, room);
    await f.sql`update rounds set competition_type='ranked',format_id='freestyle',format_version=1,preset_version=1,ladder_id='freestyle' where id=${roundId}`;
    await playOut(f, roundId, true);
    await finalizeAsWeb(f, roundId);
    await seedSettledAttendanceLedger(f, roundId);
    try {
      await withSeasons(databaseUrl, (s) =>
        s.activateBetaSeason({ id: seasonId }),
      );
      await f.sql`update round_judging_jobs set status='failed',terminal_reason='attempts_exhausted' where round_id=${roundId}`;
      const seen = () =>
        f.store.readLaunchedRound(roundId, f.host, () => true, roundWaitingOn);
      const waiting = await seen();
      const [{ deadline }] =
        await f.sql`select to_char(ballot_deadline_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as deadline from rounds where id=${roundId}`;
      await submitHumanBallot(
        f,
        roundId,
        f.outsider.actorId,
        1,
        fixtureBallot('The negative answered the decisive clash.', 'negative'),
      );
      await finalizeByMaintenance(f, roundId);
      const done = (await f.store.getRound(roundId))!;
      const [receipt] =
        await f.sql`select result from round_commands where round_id=${roundId} and type='complete'`;
      await recoverRatedResults(f);
      const ledger =
        await f.sql`select actor_id from rating_changes where round_id=${roundId}`;
      assert({
        given: 'a ranked mixed panel on a complete freeze whose AI job failed',
        should:
          'show the human window to its persisted deadline, complete on the human ballot and rate once',
        actual: {
          waitingOn: waiting.waitingOn,
          done: [done.status, done.outcome],
          ruling: receipt?.result.ruling,
          postings: ledger.length,
        },
        expected: {
          waitingOn: { state: 'human_window', deadlineAt: deadline },
          done: ['completed', 'negative'],
          ruling: 'partial',
          postings: 2,
        },
      });
    } finally {
      await f.sql`delete from rating_changes where round_id=${roundId}`;
      await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
      await f.sql`delete from outbox where topic=${buildRoundTopic(roundId)}`;
      await f.sql`delete from rounds where id=${roundId}`;
      await f.sql`delete from seasons where id=${seasonId}`;
    }
  }, judgingOptions);
});
